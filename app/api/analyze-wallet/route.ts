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
  provider: "groq" | "fallback";
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
    const val = BigInt(weiStr);
    return Number(val / BigInt(1e12)) / 1e6;
  } catch {
    return 0;
  }
}

async function fetchOnchainSummary(address: string): Promise<OnchainSummary | null> {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) return null;

  const base = "https://api.etherscan.io/api";
  const txUrl = `${base}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc&apikey=${apiKey}`;
  const tokenUrl = `${base}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc&apikey=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const [txRes, tokenRes] = await Promise.all([
      fetch(txUrl, { signal: controller.signal }),
      fetch(tokenUrl, { signal: controller.signal }),
    ]);
    clearTimeout(timeout);

    const txJson = (await txRes.json()) as { status: string; result: EtherscanTx[] | string };
    const tokenJson = (await tokenRes.json()) as { status: string; result: EtherscanTx[] | string };

    const txs: EtherscanTx[] = txJson.status === "1" && Array.isArray(txJson.result) ? txJson.result : [];
    const tokens: EtherscanTx[] = tokenJson.status === "1" && Array.isArray(tokenJson.result) ? tokenJson.result : [];

    if (txs.length === 0 && tokens.length === 0) return null;

    const contractCalls = txs.filter((t) => t.input !== "0x").length;
    const errorTxs = txs.filter((t) => t.isError === "1").length;
    const gasValues = txs.map((t) => Number(t.gasUsed)).filter((n) => n > 0);
    const avgGasUsed = gasValues.length ? Math.round(gasValues.reduce((a, b) => a + b, 0) / gasValues.length) : 0;
    const counterparties = new Set(txs.map((t) => (t.from.toLowerCase() === address.toLowerCase() ? t.to : t.from)).filter(Boolean));
    const timestamps = txs.map((t) => Number(t.timeStamp)).filter((n) => n > 0).sort((a, b) => a - b);
    const firstTs = timestamps[0] ?? null;
    const lastTs = timestamps[timestamps.length - 1] ?? null;
    const valueMovedEth = txs.filter((t) => t.from.toLowerCase() === address.toLowerCase()).reduce((acc, t) => acc + weiToEth(t.value), 0);
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
      valueMovedEth: Math.round(valueMovedEth * 1e6) / 1e6,
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

function createFallbackAnalysis(address: string, market?: MarketInput): Omit<AnalysisResult, "provider" | "onchainSource"> {
  const seed = hashString(address.toLowerCase() || "empty");
  const profiles = ["高リスク短期トレーダー", "スマートマネー追従型", "長期ガチホ寄り", "DeFiアクティブ運用型", "Meme高回転型"];
  const summaries = [
    "このウォレットは短期の値幅取りが強く、DEX利用と高速回転が目立ちます。",
    "市場の強いテーマに素早く反応するタイプで、資金移動のスピードが速いです。",
    "保有期間が長めで、少数銘柄に集中する傾向が見られます。",
    "流動性提供やDeFi運用が活発で、資金効率を重視しています。",
    "Meme系トークンへの参加が多く、ボラティリティ耐性が高いです。",
  ];
  const verdicts = [
    "短期変動に強いが、下落局面では撤退も速いタイプです。",
    "トレンドの初動を拾う動きが見られ、追随判断が早いです。",
    "銘柄数は絞り気味で、時間を味方にする運用です。",
    "利回りと回転効率の両方を見ている、上級者寄りの使い方です。",
    "話題性の強い資産に乗る傾向があり、結果が大きく振れやすいです。",
  ];
  const idx = seed % profiles.length;
  return {
    profile: profiles[idx],
    summary: `${summaries[idx]} 直近の市場では ${market?.symbol ?? "unknown"} の変動が ${(market?.change24h ?? 0) >= 0 ? "+" : ""}${(market?.change24h ?? 0).toFixed(2)}%、出来高は ${Math.round(market?.volume ?? 0).toLocaleString()} です。`,
    verdict: verdicts[idx],
    tags: ["Demo Mode", "No Onchain Data", "Fallback"],
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
      return NextResponse.json({ ...createFallbackAnalysis("0xdeadbeef"), provider: "fallback", onchainSource: "none", error: "address is required" }, { status: 400 });
    }

    const onchain = await fetchOnchainSummary(address);
    const onchainSource: AnalysisResult["onchainSource"] = onchain ? "etherscan" : "none";

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ...createFallbackAnalysis(address, market), provider: "fallback", onchainSource });
    }

    // ✅ openai パッケージを使わず fetch で直接 OpenRouter を呼ぶ
    const model = process.env.GROQ_MODEL ?? "mistralai/mistral-7b-instruct:free";

    const userPayload = {
      wallet_address: address,
      onchain_summary: onchain ?? "Etherscan data unavailable.",
      market_context: { symbol: market?.symbol ?? null, change24h: market?.change24h ?? null, volume: market?.volume ?? null },
      output_requirements: {
        profile: "投資スタイルを表す短いラベル（1行・日本語）",
        summary: "1〜2文で要約（日本語）",
        verdict: "総合的な評価を1文で（日本語）",
        tags: "英語の短いタグを正確に3つ",
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://walletscope.ai",
        "X-Title": "WalletScope AI",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an on-chain wallet analyst. Produce a concise Japanese analysis. Respond with valid JSON only — no markdown fences.",
          },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`OpenRouter error: ${response.status}`);
    }

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content?.trim();

    if (!raw) {
      return NextResponse.json({ ...createFallbackAnalysis(address, market), provider: "fallback", onchainSource });
    }

    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as { profile?: string; summary?: string; verdict?: string; tags?: string[] };

    if (!parsed.profile || !parsed.summary || !parsed.verdict) {
      return NextResponse.json({ ...createFallbackAnalysis(address, market), provider: "fallback", onchainSource });
    }

    return NextResponse.json({
      profile: parsed.profile,
      summary: parsed.summary,
      verdict: parsed.verdict,
      tags: Array.isArray(parsed.tags) && parsed.tags.length >= 3 ? parsed.tags.slice(0, 3) : ["AI-assisted", "Onchain", "Live"],
      provider: "groq",
      onchainSource,
    });

  } catch (error) {
    return NextResponse.json(
      { ...createFallbackAnalysis(address || "0xdeadbeef", market), provider: "fallback", onchainSource: "none", error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
