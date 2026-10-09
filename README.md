# くものす おえかき

屋外でiPadのカメラ映像に重ねて、自由にクモの巣を描く子ども向けWeb試作です。

## Phase 1 の起動

```bash
npm install
npm run dev
```

GitHub Pages 用のビルドは `npm run build` です。Vite の base は `/kumonosu-oekaki/` に設定しています。
`main` への push で `.github/workflows/deploy.yml` がビルドと GitHub Pages 公開を行います。リポジトリ設定の Pages は GitHub Actions をソースにしてください。

## 実装済み

- iPad Safari の背面カメラ表示（許可されない場合はデモ背景）
- タッチ／マウスの自由描画、色・太さ変更、Undo、全消去
- 線の長さ・交差の検出と、クモ・蝶・てんとう虫の反応
- 晴れ・雨・風のモードと、雨粒・葉っぱの演出
- IndexedDB 優先の作品保存と簡易図鑑
- Three.js の軽量透過レイヤーによる生き物表示
- `?debug=1` のときだけ FPS・線数・点数・交差数・保存状態・カメラ状態を表示
- デバッグパネルからクモ・雨・風・保存テストを実行可能

## 実機確認

公開URLに `?debug=1` を付けると、iPad Safariでも状態を確認できます。保存テストはテスト用作品を保存後に削除するため、既存作品を変更しません。保存した作品の復元は「ずかん」から作品を選びます。

## 技術上の制限

Phase 1 はカメラ映像への画面重ね合わせです。Web版では空間固定ARを実装しておらず、iPadを動かしても巣は現実空間に固定されません。将来の Phase 2 で Mac/Xcode と Swift + ARKit を使い、描画データを再利用して移行します。

実機 iPad Air（第3世代）での確認は未検証です。HTTPS の GitHub Pages または localhost の安全な開発環境でカメラ許可を確認してください。
