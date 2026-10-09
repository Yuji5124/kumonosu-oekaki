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

### Phase 1.6 演出修正と診断

反転したThree.js投影がスプライトの表裏を反転させていたため、通常の投影に戻し、画面Y座標を明示的に変換しました。生き物は外部画像や絵文字フォントに依存しない図形スプライトです。雨・風は切り替え直後に画面内に生成し、更新は30fpsを上限として実行します（iPad実機FPSは未測定）。

`?debug=1` の折りたたみパネルで、rAF・更新回数・生成数・画面内数・座標・描画方式・エラーを確認できます。TEST SPIDER / BUTTERFLY / LADYBUG / RAIN / WIND / ALL は画面中央で演出を強制表示します。黄色い診断線は保存データに含まれません。WebGL失敗時は演出のみCanvas 2Dに切り替わります。

ブラウザ回帰テスト：`npm install` 後、`npx playwright install chromium`、別ターミナルで `npm run dev -- --port 5180`、`npm run test:browser`。投影の表示ピクセル比較、線上移動、時間差出現、保存復元、Undo/Redo、天候強制表示、カメラ拒否、WebGL喪失時のフォールバックを検証します。

iPad再テスト：通常URLで短い線を描き、即時にクモ、約0.9秒後に蝶、約1.5秒後にてんとう虫を確認。雨・風を切り替え、晴れで止まることを確認。その後保存・再読み込み・図鑑から復元します。表示が出ない場合は `?debug=1` の TEST ALL と描画状態・JSエラーを確認してください。

Phase 1 はカメラ映像への画面重ね合わせです。Web版では空間固定ARを実装しておらず、iPadを動かしても巣は現実空間に固定されません。将来の Phase 2 で Mac/Xcode と Swift + ARKit を使い、描画データを再利用して移行します。

実機 iPad Air（第3世代）での確認は未検証です。HTTPS の GitHub Pages または localhost の安全な開発環境でカメラ許可を確認してください。
