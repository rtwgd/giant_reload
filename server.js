import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const rooms = new Map();
const names = new Set();
const randomId = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const send = (ws, type, payload = {}) => ws.readyState === 1 && ws.send(JSON.stringify({type, ...payload}));
const broadcast = (room, type, payload = {}) => room.clients.forEach(c => send(c.ws, type, payload));
function makeCode(){let c;do{c=randomId()}while(rooms.has(c));return c}
function cleanName(name){return String(name||'Player').replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠 _-]/g,'').slice(0,16)||'Player'}
function cleanRoomName(name){return String(name||'Giant Reload Room').replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠 _-]/g,'').slice(0,24)||'Giant Reload Room'}
function cleanMapSize(size){return ['small','medium','large'].includes(size)?size:'medium'}
function roomState(room){return {id:room.id,name:room.name,code:room.private?room.code:null,codeRequired:room.private,started:room.started,ownerId:room.ownerId,settings:room.settings,maxPlayers:room.maxPlayers,players:[...room.clients].map(c=>({id:c.id,name:c.name}))}}
function roomList(){return [...rooms.values()].filter(room=>!room.private).map(room=>({id:room.id,name:room.name,codeRequired:false,started:room.started,players:room.clients.size,maxPlayers:room.maxPlayers,settings:room.settings}))}
function leave(client){
  const room=client.room;if(!room)return;
  room.clients.delete(client);names.delete(client.id);
  if(room.ownerId===client.id){room.ownerId=room.clients.values().next().value?.id||null;room.started=false}
  if(room.clients.size===0)rooms.delete(room.id);else broadcast(room,'room_state',{room:roomState(room)});
  broadcastAll('room_list',{rooms:roomList()});
  client.room=null;
}
function broadcastAll(type,payload={}){wss.clients.forEach(ws=>send(ws,type,payload))}
const server=http.createServer(async(req,res)=>{
  let path=decodeURIComponent(new URL(req.url,`http://${req.headers.host}`).pathname);
  if(path==='/'||path==='\\'||path==='/index.html'||path==='\\index.html')path='/giant-reload.html';
  const file=join(root,path.replace(/^[/\\]+/,''));
  if(!file.startsWith(root)){res.writeHead(403);return res.end('Forbidden')}
  try{const data=await readFile(file);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json'};res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data)}catch{res.writeHead(404);res.end('Not found')}});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{
  const client={ws,id:randomId(),name:'Player',room:null};names.add(client.id);
  send(ws,'hello',{id:client.id});
  send(ws,'room_list',{rooms:roomList()});
  ws.on('message',raw=>{
    let msg;try{msg=JSON.parse(raw)}catch{return}
    if(msg.type==='create_room'){
      leave(client);const privateRoom=!!msg.private;const room={id:randomId(),name:cleanRoomName(msg.roomName),private:privateRoom,code:privateRoom?makeCode():null,ownerId:client.id,settings:{time:180,kills:10,mapSize:cleanMapSize(msg.mapSize)},maxPlayers:Math.max(2,Math.min(32,Number(msg.maxPlayers)||8)),clients:new Set(),started:false};rooms.set(room.id,room);client.name=cleanName(msg.name);client.room=room;room.clients.add(client);send(ws,'room_created',{room:roomState(room)});broadcastAll('room_list',{rooms:roomList()});return;
    }
    if(msg.type==='join_room'){
      const room=msg.roomId?rooms.get(String(msg.roomId)):rooms.get(String(msg.code||'').toUpperCase());if(!room)return send(ws,'error',{message:'部屋が見つかりません'});if(room.private&&String(msg.code||'').toUpperCase()!==room.code)return send(ws,'error',{message:'部屋コードが違います'});if(room.started)return send(ws,'error',{message:'試合中の部屋には参加できません'});if(room.clients.size>=room.maxPlayers)return send(ws,'error',{message:'この部屋は満員です'});leave(client);client.name=cleanName(msg.name);client.room=room;room.clients.add(client);broadcast(room,'room_state',{room:roomState(room)});broadcastAll('room_list',{rooms:roomList()});return;
    }
    if(msg.type==='list_rooms'){send(ws,'room_list',{rooms:roomList()});return}
    const room=client.room;if(!room)return;
    if(msg.type==='set_settings'&&room.ownerId===client.id&&!room.started){room.settings={time:Math.max(30,Math.min(1800,Number(msg.time)||180)),kills:Math.max(1,Math.min(100,Number(msg.kills)||10)),mapSize:cleanMapSize(msg.mapSize||room.settings.mapSize)};room.maxPlayers=Math.max(2,Math.min(32,Number(msg.maxPlayers)||room.maxPlayers));broadcast(room,'room_state',{room:roomState(room)});broadcastAll('room_list',{rooms:roomList()});return}
    if(msg.type==='start_game'&&room.ownerId===client.id&&!room.started){room.started=true;broadcast(room,'game_start',{settings:room.settings,players:roomState(room).players});broadcastAll('room_list',{rooms:roomList()});return}
    if(msg.type==='game_end'&&room.started){room.started=false;broadcast(room,'game_end');broadcast(room,'room_state',{room:roomState(room)});broadcastAll('room_list',{rooms:roomList()});return}
    if(msg.type==='map'&&room.ownerId===client.id&&room.started){broadcast(room,'map',{grid:msg.grid,GW:msg.GW,GH:msg.GH});return}
    if(msg.type==='hit'&&room.started){const target=[...room.clients].find(c=>c.id===msg.targetId);if(target)send(target.ws,'remote_hit',{attackerId:msg.attackerId,arrowType:msg.arrowType});return}
    if(msg.type==='state'&&room.started){room.clients.forEach(other=>{if(other!==client)send(other.ws,'peer_state',{id:client.id,state:msg.state})});}
  });
  ws.on('close',()=>leave(client));
});
server.listen(port,'0.0.0.0',()=>console.log(`Giant Reload server listening on ${port}`));
