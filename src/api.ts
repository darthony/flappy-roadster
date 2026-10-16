export interface ScoreRow { nickname: string; score: number; created_at: string }
export interface SubmitResult { rank: number; nickname: string; score: number; top: ScoreRow[] }

export async function fetchTop(): Promise<ScoreRow[]> {
  const r = await fetch('/api/scores', { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).top as ScoreRow[];
}

export async function submitScore(nickname: string, score: number): Promise<SubmitResult> {
  const r = await fetch('/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname, score }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data as SubmitResult;
}
