import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarketInput = {
  symbol?: string;
  change24h?: number | null;
  volume?: number | null;
};

type RequestBody = {
  address?: string;
  market?: MarketInput;
  language?: string;
};

type AnalysisResult = {
  profile: string;
  summary: string;
  verdict: string;
  tags: string[];
  provider: "gemini" | "fallback";
  onchainSource: "etherscan" | "none";
  error?: string;
};

type EtherscanTx = {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  timeStamp: string;
  isError: string;
  input: string;
  tokenSymbol?: string;
};

type OnchainSummary = {
  recentTxCount: number;
  contractCallRatio: number;
  avgGasUsed: number;
  uniqueCounterparties: number;
  firstSeenDate: string | null;
  lastSeenDate: string | null;
  estimatedHoldDays: number | null;
  errorTxRatio: number;
  topTokenSymbols: string[];
  valueMovedEth: number;
};

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function weiToEth(weiStr: string): number {
  try {
    return Number(BigInt(weiStr)) / 1e18;
  } catch {
    return 0;
  }
}

async function fetchOnchainSummary(address: string): Promise<OnchainSummary | null> {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) return null;

  const base = "https://api.etherscan.io/api";
  const params = `&address=${address}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc&apikey=${apiKey}`;
  const txUrl = `${base}?module=account&action=txlist${params}`;
  const tokenUrl = `${base}?module=account&action=tokentx${params}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const [txRes, tokenRes] = await Promise.all([
      fetch(txUrl, { signal: controller.signal }),
      fetch(tokenUrl, { signal: controller.signal }),
    ]);
    clearTimeout(timeout);

    const txJson = await txRes.json();
    const tokenJson = await tokenRes.json();

    const txs: EtherscanTx[] = txJson.status === "1" && Array.isArray(txJson.result) ? txJson.result : [];
    const tokens: EtherscanTx[] = tokenJson.status === "1" && Array.isArray(tokenJson.result) ? tokenJson.result : [];

    if (txs.length === 0 && tokens.length === 0) return null;

    const contractCalls = txs.filter((t) => t.input !== "0x").length;
    const errorTxs = txs.filter((t) => t.isError === "1").length;
    const gasValues = txs.map((t) => Number(t.gasUsed)).filter((n) => n > 0);
    const avgGasUsed = gasValues.length ? Math.round(gasValues.reduce((a, b) => a + b, 0) / gasValues.length) : 0;
    const lowerAddr = address.toLowerCase();
    const counterparties = new Set(txs.map((t) => (t.from.toLowerCase() === lowerAddr ? t.to : t.from)).filter(Boolean));
    const timestamps = txs.map((t) => Number(t.timeStamp)).filter((n) => n > 0).sort((a, b) => a - b);
    const firstTs = timestamps[0] ?? null;
    const lastTs = timestamps[timestamps.length - 1] ?? null;
    const valueMovedEth = txs.filter((t) => t.from.toLowerCase() === lowerAddr).reduce((acc, t) => acc + weiToEth(t.value), 0);
    const symbolCount: Record<string, number> = {};
    for (const t of tokens) {
      if (t.tokenSymbol) symbolCount[t.tokenSymbol] = (symbolCount[t.tokenSymbol] ?? 0) + 1;
    }
    const topTokenSymbols = Object.entries(symbolCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([sym]) => sym);

    return {
      recentTxCount: txs.length,
      contractCallRatio: txs.length ? contractCalls / txs.length : 0,
      avgGasUsed,
      uniqueCounterparties: counterparties.size,
      firstSeenDate: firstTs ? new Date(firstTs * 1000).toISOString().slice(0, 10) : null,
      lastSeenDate: lastTs ? new Date(lastTs * 1000).toISOString().slice(0, 10) : null,
      estimatedHoldDays: firstTs && lastTs ? Math.round((lastTs - firstTs) / 86400) : null,
      errorTxRatio: txs.length ? errorTxs / txs.length : 0,
      topTokenSymbols,
      valueMovedEth: Math.round(valueMovedEth * 1e4) / 1e4,
    };
  } catch (err) {
    clearTimeout(timeout);
    console.error("Onchain fetch error:", err);
    return null;
  }
}

function createFallbackAnalysis(address: string, market?: MarketInput): Omit<AnalysisResult, "provider" | "onchainSource"> {
  const seed = hashString(address.toLowerCase() || "empty");
  const profiles = ["高リスク短期トレーダー", "スマートマネー追従型", "長期ガチホ寄り", "DeFiアクティブ運用型", "Meme高回転型"];
  const summaries = [
    "短期的な値幅取りを優先し、DEXでの高速な取引が目立ちます。",
    "市場のトレンドに敏感で、クジラの動きに同調する傾向があります。",
    "資産を動かさず、特定の有望銘柄を長期保有するスタイルです。",
    "流動性提供やレンディングなど、オンチェーンの利回りを最大化しています。",
    "話題のミームコインへ積極的に参加し、高いリスク許容度を持っています。",
  ];
  const verdicts = [
    "ボラティリティを味方にする判断の速さが特徴です。",
    "情報の鮮度を重視した、機動力のある運用を行っています。",
    "市場のノイズに惑わされない、堅実なスタンスです。",
    "スマートコントラクトを使いこなす、習熟度の高いユーザーです。",
    "ハイリスク・ハイリターンを狙う、勝負師的な側面があります。",
  ];
  const idx = seed % profiles.length;
  const changeStr = (market?.change24h ?? 0) >= 0 ? "+" : "";
  return {
    profile: profiles[idx],
    summary: `${summaries[idx]} 現在 ${market?.symbol ?? "対象銘柄"} は前日比 ${changeStr}${(market?.change24h ?? 0).toFixed(2)}% で推移しています。`,
    verdict: verdicts[idx],
    tags: ["Fallback", "Simulation", "No-Data"],
  };
}

export async function POST(req: Request): Promise<NextResponse<AnalysisResult>> {
  let address = "";
  let market: MarketInput | undefined;

  try {
    const body = (await req.json()) as RequestBody;
    address = (body.address ?? "").trim();
    market = body.market;

    if (!address) {
      return NextResponse.json(
        { ...createFallbackAnalysis("0xdeadbeef"), provider: "fallback", onchainSource: "none", error: "Address is required" },
        { status: 400 }
      );
    }

    const onchain = await fetchOnchainSummary(address);
    const onchainSource: AnalysisResult["onchainSource"] = onchain ? "etherscan" : "none";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ...createFallbackAnalysis(address, market), provider: "fallback", onchainSource });
    }

    const prompt = `あなたはプロのオンチェーンアナリストです。以下のデータから投資家のペルソナを特定してください。

【分析対象】
アドレス: ${address}
直近20件の統計: ${onchain ? JSON.stringify(onchain) : "データなし（市場データのみで推測してください）"}
現在の市場環境 (${market?.symbol ?? "Unknown"}): 24h騰落率 ${market?.change24h}% / 出来高 ${market?.volume}

【出力形式】
必ず以下のJSON形式のみで回答してください。
{
  "profile": "投資スタイルを象徴する短い二つ名",
  "summary": "データに基づいた行動特徴の要約（日本語2文以内）",
  "verdict": "今後の市場に対するこのユーザーのアプローチへの助言（日本語1文）",
  "tags": ["Tag1", "Tag2", "Tag3"]
}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) throw new Error(`Gemini API returned ${response.status}`);

    const data = await response.json();
    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawContent) throw new Error("Empty AI response");

    const parsed = JSON.parse(rawContent);

    return NextResponse.json({
      profile: parsed.profile || "分析不能",
      summary: parsed.summary || "有効なデータが得られませんでした。",
      verdict: parsed.verdict || "慎重な判断を推奨します。",
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3) : ["AI-Analyzed"],
      provider: "gemini",
      onchainSource,
    });

  } catch (error) {
    console.error("POST Handler Error:", error);
    return NextResponse.json(
      {
        ...createFallbackAnalysis(address || "0xdeadbeef", market),
        provider: "fallback",
        onchainSource: "none",
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
