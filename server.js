import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const rooms = new Map();
const roomCodes = new Map();
const names = new Set();
const randomId = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const send = (ws, type, payload = {}) => ws.readyState === 1 && ws.send(JSON.stringify({type, ...payload}));
const broadcast = (room, type, payload = {}) => room.clients.forEach(c => send(c.ws, type, payload));
function makeCode(){let c;do{c=randomId()}while(rooms.has(c)||roomCodes.has(c));return c}
function findRoomByCode(code){const key=String(code||'').toUpperCase();return key?roomCodes.get(key)||null:null}
function findRoomByReference(ref){if(ref==null)return null;const key=String(ref);if(rooms.has(key))return rooms.get(key);return findRoomByCode(key)}
function cleanName(name){return String(name||'Player').replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠 _-]/g,'').slice(0,16)||'Player'}
function cleanRoomName(name){return String(name||'Giant Reload Room').replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠 _-]/g,'').slice(0,24)||'Giant Reload Room'}
function cleanMapSize(size){return ['small','medium','large'].includes(size)?size:'medium'}
function cleanBotCount(count,fallback=3){const n=Number(count);return Number.isFinite(n)?Math.max(0,Math.min(16,Math.trunc(n))):fallback}
function cleanTeamCount(count){const n=Number(count);return Number.isFinite(n)?Math.max(2,Math.min(4,Math.trunc(n))):2}
function cleanTeam(team,count){const n=Number(team);return Number.isInteger(n)&&n>=0&&n<count?n:null}
function teamOfLeastMembers(room){
  const counts=Array(room.settings.teamCount).fill(0);
  for(const client of room.clients)if(Number.isInteger(client.team)&&client.team<counts.length)counts[client.team]++;
  for(const team of room.settings.botTeams)if(Number.isInteger(team)&&team<counts.length)counts[team]++;
  return counts.indexOf(Math.min(...counts));
}
function balanceTeams(room){
  const members=[...room.clients].map(client=>({set:team=>client.team=team}));
  for(let i=0;i<room.settings.bots;i++)members.push({set:team=>room.settings.botTeams[i]=team});
  for(const client of room.clients)client.team=null;
  room.settings.botTeams=Array(room.settings.bots).fill(null);
  for(let i=members.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[members[i],members[j]]=[members[j],members[i]]}
  for(const member of members)member.set(teamOfLeastMembers(room));
}
function normalizeBotTeams(room,count=room.settings.bots){
  const teams=Array.isArray(room.settings.botTeams)?room.settings.botTeams.slice(0,count):[];
  room.settings.botTeams=[];
  for(let i=0;i<count;i++)room.settings.botTeams.push(cleanTeam(teams[i],room.settings.teamCount)??teamOfLeastMembers(room));
}
function roomState(room){return {id:room.id,name:room.name,code:room.private?room.code:null,codeRequired:room.private,started:room.started,ownerId:room.ownerId,settings:room.settings,maxPlayers:room.maxPlayers,players:[...room.clients].map(c=>({id:c.id,name:c.name,team:c.team}))}}
function roomList(){return [...rooms.values()].filter(room=>!room.private).map(room=>({id:room.id,name:room.name,codeRequired:false,started:room.started,players:room.clients.size,maxPlayers:room.maxPlayers,settings:room.settings}))}
function leave(client){
  const room=client.room;if(!room)return;
  room.clients.delete(client);names.delete(client.id);
  if(room.settings.teamMode&&room.settings.teamAssignment==='manual')normalizeBotTeams(room);
  if(room.ownerId===client.id){room.ownerId=room.clients.values().next().value?.id||null;room.started=false}
  if(room.clients.size===0){rooms.delete(room.id);if(room.code)roomCodes.delete(room.code)}else broadcast(room,'room_state',{room:roomState(room)});
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
  const client={ws,id:randomId(),name:'Player',room:null,team:0};names.add(client.id);
  send(ws,'hello',{id:client.id});
  send(ws,'room_list',{rooms:roomList()});
  ws.on('message',raw=>{
    let msg;try{msg=JSON.parse(raw)}catch{return}
    if(msg.type==='create_room'){
      leave(client);const privateRoom=!!msg.private;const room={id:randomId(),name:cleanRoomName(msg.roomName),private:privateRoom,code:privateRoom?makeCode():null,ownerId:client.id,settings:{time:180,kills:10,mapSize:cleanMapSize(msg.mapSize),bots:3,aimAssist:true,teamMode:false,teamCount:2,teamAssignment:'random',botTeams:[]},maxPlayers:Math.max(2,Math.min(32,Number(msg.maxPlayers)||8)),clients:new Set(),started:false,awaitingReturn:false};if(room.private&&room.code)roomCodes.set(room.code,room);rooms.set(room.id,room);client.name=cleanName(msg.name);client.room=room;client.team=0;room.clients.add(client);normalizeBotTeams(room);send(ws,'room_created',{room:roomState(room)});broadcastAll('room_list',{rooms:roomList()});return;
    }
    if(msg.type==='join_room'){
      const room=msg.roomId?rooms.get(String(msg.roomId)):findRoomByCode(msg.code);if(!room)return send(ws,'error',{message:'部屋が見つかりません'});if(room.private&&String(msg.code||'').toUpperCase()!==room.code)return send(ws,'error',{message:'部屋コードが違います'});if(room.started)return send(ws,'error',{message:'試合中の部屋には参加できません'});if(room.clients.size>=room.maxPlayers)return send(ws,'error',{message:'この部屋は満員です'});leave(client);client.name=cleanName(msg.name);client.room=room;client.team=room.settings.teamMode&&room.settings.teamAssignment==='manual'?teamOfLeastMembers(room):0;room.clients.add(client);broadcast(room,'room_state',{room:roomState(room)});broadcastAll('room_list',{rooms:roomList()});return;
    }
    if(msg.type==='list_rooms'){send(ws,'room_list',{rooms:roomList()});return}
    const room=client.room;if(!room)return;
    if(msg.type==='set_settings'&&room.ownerId===client.id&&!room.started){const wasTeamMode=room.settings.teamMode;room.settings={...room.settings,time:Math.max(30,Math.min(1800,Number(msg.time)||180)),kills:Math.max(1,Math.min(100,Number(msg.kills)||10)),mapSize:cleanMapSize(msg.mapSize||room.settings.mapSize),bots:cleanBotCount(msg.bots,room.settings.bots),aimAssist:typeof msg.aimAssist==='boolean'?msg.aimAssist:room.settings.aimAssist,teamMode:typeof msg.teamMode==='boolean'?msg.teamMode:room.settings.teamMode,teamCount:cleanTeamCount(msg.teamCount??room.settings.teamCount),teamAssignment:msg.teamAssignment==='manual'?'manual':msg.teamAssignment==='random'?'random':room.settings.teamAssignment};room.maxPlayers=Math.max(2,Math.min(32,Number(msg.maxPlayers)||room.maxPlayers));if(!wasTeamMode&&room.settings.teamMode)balanceTeams(room);else{for(const member of room.clients)member.team=cleanTeam(member.team,room.settings.teamCount)??teamOfLeastMembers(room);normalizeBotTeams(room)}broadcast(room,'room_state',{room:roomState(room)});broadcastAll('room_list',{rooms:roomList()});return}
    if(msg.type==='team_assignments'&&room.ownerId===client.id&&!room.started&&room.settings.teamMode&&room.settings.teamAssignment==='manual'){const assignments=Array.isArray(msg.assignments)?msg.assignments:[];for(const item of assignments){const team=cleanTeam(item?.team,room.settings.teamCount);if(team===null)continue;if(item.type==='player'){const member=[...room.clients].find(c=>c.id===item.id);if(member)member.team=team}else if(item.type==='bot'&&Number.isInteger(item.index)&&item.index>=0&&item.index<room.settings.bots)room.settings.botTeams[item.index]=team}normalizeBotTeams(room);broadcast(room,'room_state',{room:roomState(room)});return}
    if(msg.type==='start_game'&&room.ownerId===client.id&&!room.started&&!room.awaitingReturn){if(room.settings.teamMode){if(room.settings.teamAssignment==='random')balanceTeams(room);normalizeBotTeams(room)}room.started=true;broadcast(room,'game_start',{settings:room.settings,players:roomState(room).players});broadcastAll('room_list',{rooms:roomList()});return}
    if(msg.type==='game_end'&&room.started){room.started=false;room.awaitingReturn=true;broadcast(room,'game_end');broadcast(room,'room_state',{room:roomState(room)});broadcastAll('room_list',{rooms:roomList()});return}
    if(msg.type==='return_to_room'&&room.ownerId===client.id&&!room.started&&room.awaitingReturn){room.awaitingReturn=false;broadcast(room,'return_to_room',{room:roomState(room)});return}
    if(msg.type==='map'&&room.ownerId===client.id&&room.started){broadcast(room,'map',{grid:msg.grid,GW:msg.GW,GH:msg.GH});return}
    if(msg.type==='hit'&&room.started){const target=[...room.clients].find(c=>c.id===msg.targetId);if(target)send(target.ws,'remote_hit',{attackerId:msg.attackerId,arrowType:msg.arrowType});return}
    if(msg.type==='state'&&room.started){room.clients.forEach(other=>{if(other!==client)send(other.ws,'peer_state',{id:client.id,state:msg.state})});}
  });
  ws.on('close',()=>leave(client));
});
server.listen(port,'0.0.0.0',()=>console.log(`Giant Reload server listening on ${port}`));
