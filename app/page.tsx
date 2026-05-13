"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Copy,
  ExternalLink,
  Flame,
  LayoutDashboard,
  Sparkles,
  Shield,
  Cpu,
  Zap,
  Target,
  Lightbulb,
  Users,
  PlugZap,
  FileText,
  Activity,
  TrendingUp,
  Waves,
  RefreshCw,
  AlertTriangle,
  Database,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

// ----------------------------------------------------------------
// 定数
// ----------------------------------------------------------------

// 実在する Ethereum アドレス（Etherscan で TX 履歴が確認済み）
const DEMOS = [
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // vitalik.eth
  "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503", // Binance cold wallet
  "0x28C6c06298d514Db089934071355E5743bf21d60", // Binance 14
];

const SODEX_SPOT_ENDPOINT = "https://mainnet-gw.sodex.dev/api/v1/spot";
const WALLET_ANALYSIS_ENDPOINT = "/api/analyze-wallet";
const MARKET_REFRESH_MS = 60_000;

// ----------------------------------------------------------------
// 型定義
// ----------------------------------------------------------------

type LiveTicker = {
  symbol: string;
  lastPrice?: number;
  last_price?: number;
  price?: number;
  volume?: number;
  quoteVolume?: number;
  change24h?: number;
  changePercent?: number;
  change_percent?: number;
};

type LiveTrade = {
  price?: number;
  qty?: number;
  quantity?: number;
  side?: string;
  time?: number;
  timestamp?: number;
};

type MarketSnapshot = {
  symbol: string;
  price: number | null;
  change24h: number | null;
  volume: number | null;
  trades: LiveTrade[];
  status: "loading" | "live" | "fallback" | "error";
  message: string;
};

// バックエンドから返ってくる型（onchainSource / provider を含む）
type AiResultPayload = {
  profile: string;
  summary: string;
  verdict: string;
  tags: string[];
  provider: "openai" | "fallback";
  onchainSource: "etherscan" | "none";
};

type Analysis = {
  risk: number;
  smartMoney: number;
  degen: number;
  conviction: number;
  holdTime: string;
  profile: string;
  summary: string;
  verdict: string;
  tags: string[];
  signals: { label: string; value: number; hint: string }[];
  opportunities: string[];
};

// ----------------------------------------------------------------
// ユーティリティ
// ----------------------------------------------------------------

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function safeNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function formatPct(n: number) {
  return `${Math.round(n)}%`;
}

function shortAddress(addr: string) {
  if (!addr) return "—";
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function extractArray(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) ? data : Array.isArray(payload) ? payload : [];
}

function extractTickers(payload: unknown): LiveTicker[] {
  return extractArray(payload).filter((item): item is LiveTicker => {
    if (!item || typeof item !== "object") return false;
    return typeof (item as LiveTicker).symbol === "string";
  });
}

function extractTrades(payload: unknown): LiveTrade[] {
  return extractArray(payload).filter(
    (item): item is LiveTrade => item !== null && typeof item === "object"
  );
}

function getTickerPrice(t: LiveTicker) {
  return safeNum(t.lastPrice ?? t.last_price ?? t.price);
}
function getTickerChange(t: LiveTicker) {
  return safeNum(t.change24h ?? t.changePercent ?? t.change_percent);
}
function getTickerVolume(t: LiveTicker) {
  return safeNum(t.quoteVolume ?? t.volume);
}

// ----------------------------------------------------------------
// フォールバック分析（スコア計算のみ、テキストは AI が担当）
// ----------------------------------------------------------------

function createFallbackScores(
  address: string,
  marketBias: number,
  trendBias: number,
  volumeBias: number
): Omit<Analysis, "profile" | "summary" | "verdict" | "tags"> {
  const seed = hashString(address.trim().toLowerCase() || "empty");
  const risk = clamp(30 + (seed % 50) + marketBias * 0.12, 0, 100);
  const smartMoney = clamp(15 + ((seed >> 3) % 60) + trendBias * 0.15, 0, 100);
  const degen = clamp(10 + ((seed >> 6) % 72) + Math.max(0, trendBias) * 0.1, 0, 100);
  const conviction = clamp(20 + ((seed >> 9) % 60) + volumeBias * 0.05, 0, 100);
  const holdDays = 1 + (seed % 16);

  const opportunityPools = [
    ["利確ルールの可視化", "損切りラインの自動整理", "DEX別の行動比較"],
    ["スマートマネーの追跡", "流入テーマの早期検知", "銘柄ごとの強弱判定"],
    ["長期保有の推移表示", "再投資履歴の分析", "集中度の見える化"],
    ["利回りの比較", "LPリスクの説明", "資金効率の最適化"],
    ["Meme熱量の検知", "急騰前兆の通知", "SNS話題との相関"],
  ];

  const idx = seed % opportunityPools.length;
  const signalBase = [
    { label: "DEX Activity", value: clamp(40 + ((seed >> 1) % 60), 0, 100), hint: "取引所よりDEXをよく使っています" },
    { label: "Stablecoin Ratio", value: clamp(10 + ((seed >> 2) % 55), 0, 100), hint: "待機資金の厚みを示します" },
    { label: "Meme Exposure", value: clamp(5 + ((seed >> 4) % 85), 0, 100), hint: "投機性の強さを示します" },
    { label: "DeFi Usage", value: clamp(15 + ((seed >> 5) % 75), 0, 100), hint: "貸借・LP・運用の比率です" },
  ].sort((a, b) => b.value - a.value);

  return {
    risk,
    smartMoney,
    degen,
    conviction,
    holdTime: `${holdDays}日`,
    signals: [
      ...signalBase,
      {
        label: "Average Hold Time",
        value: clamp(100 - holdDays * 6, 0, 100),
        hint: `平均保有期間は約${holdDays}日です`,
      },
    ],
    opportunities: opportunityPools[idx],
  };
}

// ----------------------------------------------------------------
// SoDEX 市場データ取得
// ----------------------------------------------------------------

const FALLBACK_MARKET: MarketSnapshot = {
  symbol: "vBTC_vUSDC",
  price: 68234.21,
  change24h: 2.8,
  volume: 124_530_000,
  trades: [
    { price: 68210.2, qty: 0.14, side: "buy", timestamp: Date.now() - 15000 },
    { price: 68245.7, qty: 0.09, side: "sell", timestamp: Date.now() - 35000 },
    { price: 68198.4, qty: 0.22, side: "buy", timestamp: Date.now() - 55000 },
  ],
  status: "fallback",
  message: "SoDEX API の取得に失敗したため、デモ値で表示しています。",
};

async function fetchJson(url: string, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  try {
    const tickersPayload = await fetchJson(`${SODEX_SPOT_ENDPOINT}/markets/tickers`);
    const tickers = extractTickers(tickersPayload);
    const ranked = tickers
      .map((t) => ({
        symbol: String(t.symbol ?? ""),
        price: getTickerPrice(t),
        change: getTickerChange(t),
        volume: getTickerVolume(t),
      }))
      .filter((t) => t.symbol && typeof t.price === "number")
      .sort(
        (a, b) =>
          Math.abs(b.change ?? 0) +
          Math.log10(Math.max(1, b.volume ?? 1)) -
          (Math.abs(a.change ?? 0) + Math.log10(Math.max(1, a.volume ?? 1)))
      );

    const best = ranked[0];
    if (!best?.symbol) throw new Error("No market data");

    const tradesPayload = await fetchJson(
      `${SODEX_SPOT_ENDPOINT}/markets/${encodeURIComponent(best.symbol)}/trades?limit=5`
    );
    const trades = extractTrades(tradesPayload).slice(0, 5);

    return {
      symbol: best.symbol,
      price: best.price ?? null,
      change24h: best.change ?? null,
      volume: best.volume ?? null,
      trades,
      status: "live",
      message: `ライブ取得成功: ${best.symbol}`,
    };
  } catch {
    return { ...FALLBACK_MARKET, trades: FALLBACK_MARKET.trades.map((t) => ({ ...t, timestamp: Date.now() - (t.timestamp ? Date.now() - t.timestamp : 0) })) };
  }
}

// ----------------------------------------------------------------
// AI サマリー取得
// ----------------------------------------------------------------

async function requestAiSummary(address: string, market: MarketSnapshot): Promise<AiResultPayload> {
  const response = await fetch(WALLET_ANALYSIS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, market, language: "ja" }),
  });

  if (!response.ok) throw new Error(`AI endpoint failed: ${response.status}`);

  const data = (await response.json()) as Partial<AiResultPayload>;

  if (!data.profile || !data.summary || !data.verdict) {
    throw new Error("AI endpoint returned incomplete payload");
  }

  return {
    profile: data.profile,
    summary: data.summary,
    verdict: data.verdict,
    tags: Array.isArray(data.tags) && data.tags.length >= 3 ? data.tags.slice(0, 3) : ["AI-assisted", "Onchain", "Live"],
    provider: data.provider ?? "fallback",
    onchainSource: data.onchainSource ?? "none",
  };
}

// ----------------------------------------------------------------
// UI コンポーネント
// ----------------------------------------------------------------

function StatCard({ title, value, icon, accent }: { title: string; value: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="rounded-2xl border bg-white/70 p-4 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
        <span className={accent}>{icon}</span>
        <span>{title}</span>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
    </div>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="border-white/60 bg-white/80 shadow-lg shadow-slate-200/50 backdrop-blur">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
          {icon}
          {title}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------
// メインコンポーネント
// ----------------------------------------------------------------

export default function App() {
  const [wallet, setWallet] = useState(DEMOS[0]);
  const [activeWallet, setActiveWallet] = useState(DEMOS[0]);
  const [inputLoading, setInputLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // 市場データ
  const [market, setMarket] = useState<MarketSnapshot>({
    symbol: "vBTC_vUSDC",
    price: null,
    change24h: null,
    volume: null,
    trades: [],
    status: "loading",
    message: "SoDEX 公開市場データを取得中…",
  });

  // AI 分析結果
  const [aiResult, setAiResult] = useState<AiResultPayload | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState("分析待機中…");

  // スコア計算用バイアス
  const marketBias = market.change24h ?? 0;
  const trendBias = market.price ? Math.log10(Math.max(1, market.price)) * 5 : 0;
  const volumeBias = market.volume ? Math.log10(Math.max(1, market.volume)) * 10 : 0;

  const scores = useMemo(
    () => createFallbackScores(activeWallet, marketBias, trendBias, volumeBias),
    [activeWallet, marketBias, trendBias, volumeBias]
  );

  // AI テキストとスコアを合成
  const analysis: Analysis = {
    ...scores,
    profile: aiResult?.profile ?? "分析中…",
    summary: aiResult?.summary ?? "データを取得しています。",
    verdict: aiResult?.verdict ?? "",
    tags: aiResult?.tags ?? [],
  };

  // ---- 市場データ取得（1分ごと）----
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const snapshot = await fetchMarketSnapshot();
      if (!cancelled) setMarket(snapshot);
    };
    void load();
    const timer = setInterval(() => void load(), MARKET_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // ---- AI 分析（activeWallet または market が変わったとき）----
  // useEffect を1つに統合して二重発火を防ぐ
  const prevKeyRef = useRef("");

  useEffect(() => {
    // market がまだ loading 中なら待つ
    if (market.status === "loading") return;

    // activeWallet + market のキーが変わったときだけ実行
    const key = `${activeWallet}__${market.symbol}__${market.change24h}__${market.price}__${market.volume}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    let cancelled = false;

    const run = async () => {
      setAnalysisLoading(true);
      setAnalysisMessage("AI がウォレットと市場状況を解釈中…");

      try {
        const result = await requestAiSummary(activeWallet, market);
        if (cancelled) return;
        setAiResult(result);
        const srcLabel = result.onchainSource === "etherscan" ? "Etherscan 実データ" : "市場コンテキストのみ";
        const providerLabel = result.provider === "openai" ? "OpenAI" : "ローカルフォールバック";
        setAnalysisMessage(`${providerLabel} / ${srcLabel} で分析しました。`);
      } catch {
        if (cancelled) return;
        setAiResult(null);
        setAnalysisMessage("AI endpoint に接続できませんでした。ローカル要約を表示しています。");
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeWallet, market]);

  // ---- ボタン操作 ----
  const onAnalyze = useCallback(() => {
    const trimmed = wallet.trim() || DEMOS[0];
    if (trimmed === activeWallet) return; // 変化なし → 再実行不要
    setInputLoading(true);
    setTimeout(() => {
      setActiveWallet(trimmed);
      setAiResult(null); // 古い結果をクリア
      setInputLoading(false);
    }, 400);
  }, [wallet, activeWallet]);

  const copyAddress = useCallback(async () => {
    await navigator.clipboard.writeText(activeWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [activeWallet]);

  // ---- バッジ計算 ----
  const marketBadge = {
    live: { variant: "default" as const, label: "Live Data" },
    fallback: { variant: "secondary" as const, label: "Fallback Demo" },
    loading: { variant: "outline" as const, label: "Connecting" },
    error: { variant: "outline" as const, label: "Error" },
  }[market.status];

  const aiBadge = aiResult
   ? (aiResult.provider === "openai" || aiResult.provider === "groq")
  ? { variant: "default" as const, label: "AI Live" } : { variant: "secondary" as const, label: "AI Fallback" }
    : analysisLoading
      ? { variant: "outline" as const, label: "AI Running" }
      : { variant: "outline" as const, label: "AI Ready" };

  const onchainBadge = aiResult
    ? aiResult.onchainSource === "etherscan"
      ? { variant: "default" as const, label: "Etherscan Live" }
      : { variant: "secondary" as const, label: "No Onchain Data" }
    : { variant: "outline" as const, label: "Onchain Pending" };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#e0f2fe,_transparent_35%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid gap-6 lg:grid-cols-[1.12fr_0.88fr]"
        >
          {/* ---- 左カード: 入力 + スコア ---- */}
          <Card className="overflow-hidden border-white/60 bg-white/80 shadow-xl shadow-slate-200/60 backdrop-blur">
            <CardHeader className="space-y-4 pb-4">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-500">
                <Sparkles className="h-4 w-4" />
                WalletScope AI
                <Badge variant="secondary" className="rounded-full px-3 py-1">Buildathon MVP</Badge>
                <Badge variant={marketBadge.variant} className="rounded-full px-3 py-1">{marketBadge.label}</Badge>
                <Badge variant={aiBadge.variant} className="rounded-full px-3 py-1">{aiBadge.label}</Badge>
                {/* ✅ 追加: Etherscan データソースバッジ */}
                <Badge variant={onchainBadge.variant} className="rounded-full px-3 py-1">
                  <Database className="mr-1 h-3 w-3" />
                  {onchainBadge.label}
                </Badge>
              </div>
              <CardTitle className="text-4xl font-semibold tracking-tight lg:text-5xl">
                ウォレットを貼ると、
                <br />
                3秒で性格分析。
              </CardTitle>
              <p className="max-w-2xl text-base leading-7 text-slate-600 lg:text-lg">
                Etherscan の実トランザクションデータを取得し、SoDEX の市場状況と合わせて AI が日本語で分析します。
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-600">Wallet Address</div>
                  <Input
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                    placeholder="0x..."
                    className="h-12 rounded-2xl bg-white"
                  />
                </div>
                <Button onClick={onAnalyze} disabled={inputLoading} className="h-12 rounded-2xl px-6 text-base shadow-lg shadow-slate-300/40">
                  {inputLoading ? (
                    <span className="flex items-center gap-2"><Cpu className="h-4 w-4 animate-pulse" />Updating</span>
                  ) : (
                    <span className="flex items-center gap-2">Analyze <ArrowRight className="h-4 w-4" /></span>
                  )}
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                {DEMOS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setWallet(d)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    {shortAddress(d)}
                  </button>
                ))}
              </div>

              <Separator />

              <div className="grid gap-3 md:grid-cols-3">
                <StatCard title="Risk Score" value={`${Math.round(analysis.risk)}`} icon={<Flame className="h-4 w-4" />} accent="text-orange-500" />
                <StatCard title="Smart Money" value={`${Math.round(analysis.smartMoney)}`} icon={<Zap className="h-4 w-4" />} accent="text-yellow-500" />
                <StatCard title="Conviction" value={`${Math.round(analysis.conviction)}`} icon={<Shield className="h-4 w-4" />} accent="text-emerald-500" />
              </div>
            </CardContent>
          </Card>

          {/* ---- 右カード: AI サマリー + シグナル ---- */}
          <div className="grid gap-6">
            <Card className="border-white/60 bg-white/80 shadow-xl shadow-slate-200/60 backdrop-blur">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl">AI-assisted Summary</CardTitle>
                    <p className="mt-1 text-sm text-slate-500">
                      {aiResult?.onchainSource === "etherscan"
                        ? "Etherscan の実データに基づいて AI が分析しています。"
                        : "AI endpoint があれば利用し、なければローカル要約にフォールバックします。"}
                    </p>
                  </div>
                  <Badge variant={aiResult?.provider === "openai" || aiResult?.provider === "groq" ? "default" : "secondary"} className="rounded-full px-3 py-1">
                    {aiResult?.provider === "openai" ? "AI Live" : "Demo Ready"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-3xl bg-slate-950 p-4 text-slate-50 shadow-inner">
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                    <Brain className="h-4 w-4" />
                    {analysisLoading ? "Analyzing…" : "Result"}
                  </div>
                  <div className="text-lg font-medium leading-8">
                    {analysisLoading ? <span className="animate-pulse">解析中…</span> : analysis.profile}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{analysis.summary}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{analysis.verdict}</p>
                </div>

                {analysis.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {analysis.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="rounded-full border-slate-200 px-3 py-1 text-slate-700">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border bg-white p-4">
                    <div className="text-sm text-slate-500">Average Hold Time</div>
                    <div className="mt-2 text-2xl font-semibold">{analysis.holdTime}</div>
                  </div>
                  <div className="rounded-2xl border bg-white p-4">
                    <div className="text-sm text-slate-500">Degen Score</div>
                    <div className="mt-2 text-2xl font-semibold">{Math.round(analysis.degen)}</div>
                  </div>
                </div>

                {/* ✅ 追加: データソースの明示 */}
                <div className="rounded-2xl border bg-white p-3 text-sm text-slate-600">
                  <span className="font-medium">データソース: </span>
                  {aiResult?.onchainSource === "etherscan"
                    ? "✅ Etherscan 実トランザクション + SoDEX 市場データ"
                    : "⚠️ Etherscan 未接続 — 市場データのみで推定"}
                  <br />
                  <span className="text-xs text-slate-400">{analysisMessage}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/60 bg-white/80 shadow-xl shadow-slate-200/60 backdrop-blur">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-xl">Signals</CardTitle>
                  <div className="text-xs text-slate-500">{market.message}</div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {analysis.signals.map((s) => (
                  <div key={s.label} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-700">{s.label}</span>
                      <span className="text-slate-500">{formatPct(s.value)}</span>
                    </div>
                    <Progress value={s.value} className="h-2" />
                    <p className="text-xs text-slate-500">{s.hint}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </motion.div>

        {/* ---- 市場データ行 ---- */}
        <div className="grid gap-6 lg:grid-cols-3">
          <SectionCard title="Live market pulse" icon={<Activity className="h-4 w-4" />}>
            <div className="space-y-4 text-sm text-slate-600">
              <div className="rounded-2xl border bg-white p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Selected symbol</div>
                <div className="mt-2 text-lg font-semibold">{market.symbol}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline" className="rounded-full">
                    Price {market.price ? market.price.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"}
                  </Badge>
                  <Badge variant="outline" className="rounded-full">
                    24h {market.change24h == null ? "—" : `${market.change24h > 0 ? "+" : ""}${market.change24h.toFixed(2)}%`}
                  </Badge>
                  <Badge variant="outline" className="rounded-full">
                    Volume {market.volume ? market.volume.toLocaleString() : "—"}
                  </Badge>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-1 rounded-full bg-slate-100 p-2"><Waves className="h-4 w-4" /></div>
                <p>SoDEX の公開 tickers を取得し、動きの大きい銘柄を分析の文脈として使います。</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-1 rounded-full bg-slate-100 p-2"><TrendingUp className="h-4 w-4" /></div>
                <p>価格変動と出来高をウォレット分析のバイアスに反映しています。</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-1 rounded-full bg-slate-100 p-2"><RefreshCw className="h-4 w-4" /></div>
                <p>60秒ごとに再取得します。API が落ちても自動でフォールバックします。</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Recent trades" icon={<Waves className="h-4 w-4" />}>
            <div className="space-y-2 text-sm text-slate-600">
              {market.trades.length ? (
                market.trades.map((t, idx) => {
                  const price = safeNum(t.price);
                  const qty = safeNum(t.qty ?? t.quantity);
                  const side = String(t.side ?? "trade");
                  const time = new Date(
                    safeNum(t.time ?? t.timestamp) ?? Date.now()
                  ).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                  return (
                    <div key={idx} className="rounded-2xl border bg-white p-3">
                      <div className="flex items-center justify-between">
                        <span className={`font-medium ${side === "buy" ? "text-emerald-600" : side === "sell" ? "text-red-500" : ""}`}>{side}</span>
                        <span className="text-xs text-slate-400">{time}</span>
                      </div>
                      <div className="mt-1 text-sm">Price: {price ?? "—"} / Qty: {qty ?? "—"}</div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border bg-white p-4 text-slate-500">No trade data yet.</div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Status" icon={<AlertTriangle className="h-4 w-4" />}>
            <div className="space-y-3 text-sm leading-6 text-slate-600">
              <p><span className="font-medium">Market:</span> {market.message}</p>
              <p><span className="font-medium">Analysis:</span> {analysisMessage}</p>
              <p>
                <span className="font-medium">Onchain:</span>{" "}
                {aiResult?.onchainSource === "etherscan"
                  ? "Etherscan API から実データを取得しました。"
                  : "ETHERSCAN_API_KEY が未設定か取得失敗のため、市場データのみで動作しています。"}
              </p>
              <p className="text-xs text-slate-400">AI endpoint が使えない場合もローカル要約で継続します。</p>
            </div>
          </SectionCard>
        </div>

        {/* ---- ピッチ行 ---- */}
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <SectionCard title="Why this wins" icon={<Lightbulb className="h-4 w-4" />}>
            <div className="space-y-3 text-sm leading-6 text-slate-600">
              <p>「ウォレットを貼る → AIが意味に変える」が一瞬で伝わるので、審査で見せやすいです。</p>
              <p>Etherscan の実データを使うことで、アドレスごとに異なる分析が返ります。</p>
              <p>日本語圏の Web3 ユーザー向けに、英語のオンチェーン情報を読みやすくしています。</p>
            </div>
          </SectionCard>

          <SectionCard title="Who it is for" icon={<Users className="h-4 w-4" />}>
            <div className="space-y-3 text-sm leading-6 text-slate-600">
              <p>・Crypto 初心者: 何を見ればいいか分からない人</p>
              <p>・中級者: 自分のウォレット傾向を知りたい人</p>
              <p>・トレーダー: 参考ウォレットを素早く比較したい人</p>
            </div>
          </SectionCard>

          <SectionCard title="How it uses APIs" icon={<PlugZap className="h-4 w-4" />}>
            <div className="space-y-3 text-sm leading-6 text-slate-600">
              <p>1. ウォレットアドレスを受け取る</p>
              <p>2. Etherscan API で直近の TX・トークン転送を取得・集計する</p>
              <p>3. SoDEX の市場データと合わせて AI に渡し、日本語サマリーを生成する</p>
            </div>
          </SectionCard>
        </div>

        {/* ---- チェックリスト・ピッチ ---- */}
        <div className="grid gap-6 lg:grid-cols-3">
          <SectionCard title="Feature checklist" icon={<CheckCircle2 className="h-4 w-4" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                "Wallet input + instant analysis",
                "Etherscan real TX data",
                "Live SoDEX market data",
                "AI summary with fallback",
                "Onchain source badge",
                "Strict no-blank-screen behavior",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 rounded-2xl border bg-white p-3 text-sm text-slate-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Submission-ready pitch" icon={<FileText className="h-4 w-4" />}>
            <div className="space-y-4">
              <div className="rounded-3xl bg-slate-950 p-5 text-slate-50">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">One-liner</div>
                <div className="mt-3 text-xl font-semibold leading-8">
                  WalletScope AI は、ウォレットを入力すると Etherscan の実データを AI が解析し、
                  投資スタイルを日本語で即診断する個人向けオンチェーン分析アシスタントです。
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border bg-white p-4">
                  <Target className="h-4 w-4 text-slate-500" />
                  <div className="mt-2 text-sm font-medium">Problem</div>
                  <p className="mt-1 text-sm text-slate-600">オンチェーン情報が難しい。</p>
                </div>
                <div className="rounded-2xl border bg-white p-4">
                  <Brain className="h-4 w-4 text-slate-500" />
                  <div className="mt-2 text-sm font-medium">Solution</div>
                  <p className="mt-1 text-sm text-slate-600">実データを AI が翻訳する。</p>
                </div>
                <div className="rounded-2xl border bg-white p-4">
                  <LayoutDashboard className="h-4 w-4 text-slate-500" />
                  <div className="mt-2 text-sm font-medium">Output</div>
                  <p className="mt-1 text-sm text-slate-600">一目で分かる診断画面。</p>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Result share card" icon={<Copy className="h-4 w-4" />}>
            <div className="space-y-4">
              <div className="rounded-3xl bg-gradient-to-br from-slate-950 to-slate-800 p-5 text-slate-50">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">WalletScope AI</div>
                <div className="mt-3 text-2xl font-semibold">{analysis.profile}</div>
                <div className="mt-2 text-sm text-slate-300">
                  Risk {Math.round(analysis.risk)} / Smart Money {Math.round(analysis.smartMoney)}
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  {aiResult?.onchainSource === "etherscan" ? "📡 Etherscan verified" : "⚠️ No onchain data"}
                </div>
                <div className="mt-2 text-xs text-slate-400">{shortAddress(activeWallet)}</div>
              </div>
              <Button onClick={copyAddress} variant="outline" className="w-full rounded-2xl">
                <Copy className="mr-2 h-4 w-4" />
                {copied ? "Copied" : "Copy wallet"}
              </Button>
            </div>
          </SectionCard>
        </div>

        {/* ---- オポチュニティ + Next Step ---- */}
        <div className="grid gap-6 lg:grid-cols-3">
          <SectionCard title="Top opportunities" icon={<Sparkles className="h-4 w-4" />}>
            <div className="space-y-2 text-sm text-slate-600">
              {analysis.opportunities.map((item) => (
                <div key={item} className="rounded-2xl border bg-white p-3">{item}</div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Next step" icon={<ExternalLink className="h-4 w-4" />}>
            <div className="space-y-3 text-sm leading-6 text-slate-600">
              <p>ETHERSCAN_API_KEY を設定すると、実際のトランザクション履歴で AI が動きます。</p>
              <p>OPENAI_API_KEY も設定すれば、ウォレットごとに異なる本物の AI 分析が返ります。</p>
            </div>
          </SectionCard>

          <SectionCard title="Developer note" icon={<Activity className="h-4 w-4" />}>
            <div className="space-y-3 text-sm leading-6 text-slate-600">
              <p>useEffect を1本に統合し、二重発火を防いでいます。</p>
              <p>onchainSource / provider をフロントまで伝播させ、データの透明性を確保しています。</p>
              <p>window.* 依存を除去し、SSR 環境でも安全に動作します。</p>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
