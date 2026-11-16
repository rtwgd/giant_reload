# Giant Reload

## ローカル起動

```powershell
npm install
npm start
```

ブラウザで `http://localhost:3000` を開きます。`server.js` がHTML配信とWebSocketの部屋管理を担当します。

## 部屋機能

- 部屋コードで参加
- オーナーだけがゲーム開始可能
- オーナーがゲーム時間と勝利キル数を設定
- WebSocketで参加者一覧と開始設定を同期

## 無料公開の想定

フロントエンドとWebSocketサーバーを同じNode.jsサービスとして公開できる構成です。RenderなどのNode.js Web Serviceにリポジトリを接続し、Build Commandを `npm install`、Start Commandを `npm start` にします。無料枠では停止・再起動により接続が切れる場合があるため、公開時には自動再接続を追加します。

## 注意

現在の通信層は部屋管理、オーナー権限、設定同期、開始通知、プレイヤー状態の中継までを実装しています。対戦を完全なホスト権威型にするには、次の段階で弾道・命中・キル・マッチ終了をサーバー側で検証する必要があります。
