# noroshi — 開発戦略・ロードマップ

## 概要

mDNS（Bonjour/Avahi）のサービス広告（publish）をGUIで簡単に管理できるデスクトップアプリケーション。

- 対象ユーザー: 開発者
- ユースケース: ローカル開発環境でサービスを `.local` ドメインで公開

## 技術スタック

| 領域 | 技術 | 選定理由 |
|---|---|---|
| フレームワーク | **Tauri v2** | 軽量（5-10MB）、Rustバックエンドで安全なOS操作、マルチOS対応 |
| フロントエンド | **React + TypeScript** | 開発者に馴染みのあるスタック |
| スタイリング | **Tailwind CSS** | 素早いUI構築 |
| mDNSライブラリ | **`mdns-sd` Rustクレート** | 純Rust実装、外部依存なし、OS抽象化 |
| 設定ファイル | **JSON** (`~/.noroshi/config.json`) | |

## 対象OS

- macOS
- Linux
- Windows

## 現状分析

- バージョン: v0.1.0
- Phase 1〜3 すべて実装済み

### 提供機能

| 機能 | 状態 |
|---|---|
| サービスの追加・編集・削除 | ✅ |
| サービス一覧テーブル表示 | ✅ |
| 個別の開始/停止トグル | ✅ |
| 一括開始/停止 | ✅ |
| リアルタイムステータス表示 | ✅ |
| タイムスタンプ付きログストリーム | ✅ |
| ネットワークインターフェース情報 | ✅ |
| JSON設定インポート/エクスポート | ✅ |
| ホスト名表示 + OS別変更ツールチップ | ✅ |

## アーキテクチャ

```
┌─────────────────────────────────────┐
│          React Frontend             │
│  ┌───────────┬──────────┬────────┐  │
│  │ サービス   │ モニター  │ 設定   │  │
│  │ 管理画面   │ 画面     │ 画面   │  │
│  └───────────┴──────────┴────────┘  │
│          Tauri IPC (invoke)         │
├─────────────────────────────────────┤
│          Rust Backend               │
│  ┌───────────┬──────────┬────────┐  │
│  │ mDNS      │ Config   │ Host   │  │
│  │ Publisher  │ Manager  │ Info   │  │
│  └─────┬─────┴────┬─────┴───┬────┘  │
│        │          │         │        │
│   mdns-sd      JSON File  OS API    │
│   crate       (~/.noroshi/) (読取専用)│
└─────────────────────────────────────┘
```

## 設定ファイル仕様

パス: `~/.noroshi/config.json`

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `version` | number | ✅ | 設定ファイルのスキーマバージョン |
| `hostname` | string | ❌ | 現在のホスト名（読み取り専用、起動時にOSから取得） |
| `services` | array | ✅ | サービス定義の配列 |
| `services[].name` | string | ✅ | サービスの表示名 |
| `services[].type` | string | ✅ | サービスタイプ（例: `_http._tcp`） |
| `services[].port` | number | ✅ | ポート番号 |
| `services[].txt` | object | ❌ | TXTレコード（key-valueペア） |
| `services[].enabled` | boolean | ✅ | 有効/無効フラグ |

## マルチOS対応方針

| 機能 | macOS | Linux | Windows |
|---|---|---|---|
| サービス広告 | `mdns-sd` crate | `mdns-sd` crate | `mdns-sd` crate |
| ホスト名取得 | `scutil --get LocalHostName` | `hostname` | `hostname` |
| 依存関係 | なし（標準搭載） | なし（純Rust実装） | なし（純Rust実装） |

## ロードマップ

### Phase 1: コア機能 ✅

- [x] サービス管理画面UI
- [x] JSON設定ファイルの読み書き
- [x] サービスのpublish/停止（`mdns-sd` クレート経由）

### Phase 2: モニタリング ✅

- [x] リアルタイムモニター画面
- [x] ログストリーム表示
- [x] サービスステータスのリアルタイム更新

### Phase 3: 設定・仕上げ ✅

- [x] インポート/エクスポートUI
- [x] ホスト名の読み取り専用表示 + 変更方法ツールチップ
- [ ] マルチOSテスト・調整
- [ ] パッケージング（各OS向けインストーラー）

### Phase 4: TBD

_今後の開発方針はここに追記する_

## スコープ外

- ホスト名の変更UI（頻度が低く、OS標準手段で十分なため除外）
- サービス発見（browse）機能
- OS起動時の自動有効化

## 参考

- 元リポジトリ: [piroz/dot-local](https://github.com/piroz/dot-local)（Electron製、アーカイブ済み）
- [mdns-sd crate](https://crates.io/crates/mdns-sd)
- [Tauri v2 ドキュメント](https://v2.tauri.app/)
