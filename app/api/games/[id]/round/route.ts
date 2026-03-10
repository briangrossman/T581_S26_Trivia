import { NextRequest, NextResponse } from 'next/server';
import { getTeacherFromCookies } from '@/lib/auth';
import { getGameById, sql, getNeonUrl } from '@/lib/db';
import { scorePromptWriting } from '@/lib/claude';
import type { Question, Answer } from '@/lib/types';

// Allow up to 5 minutes — LLM scoring can take a while with many students
export const maxDuration = 300;

const MAX_ROUND = 4;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const teacher = await getTeacherFromCookies();
  console.log('[round] teacher from cookies:', teacher);

  if (!teacher) {
    console.log('[round] Unauthorized — no teacher cookie');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = params;
    const gameId = parseInt(id, 10);
    console.log('[round] gameId from params:', id, '->', gameId);

    if (isNaN(gameId)) {
      console.log('[round] gameId is NaN, returning 400');
      return NextResponse.json({ error: 'Invalid game ID' }, { status: 400 });
    }

    const game = await getGameById(gameId);
    console.log('[round] game fetched:', game);

    if (!game) {
      console.log('[round] Game not found for id:', gameId);
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Use Number() to handle potential string/number type mismatch from DB
    if (Number(game.teacher_id) !== Number(teacher.teacherId)) {
      console.log('[round] Forbidden: game.teacher_id=', game.teacher_id,
        '(', typeof game.teacher_id, ') vs teacher.teacherId=', teacher.teacherId,
        '(', typeof teacher.teacherId, ')');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (game.status === 'finished') {
      return NextResponse.json({ error: 'Game is already finished' }, { status: 409 });
    }

    if (game.status === 'scoring') {
      return NextResponse.json({ error: 'Scoring in progress, please wait' }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const action: string = body.action ?? 'next';
    console.log('[round] action:', action, 'current_round:', game.current_round, 'status:', game.status);

    // Finish the game
    if (action === 'finish') {
      if (game.current_round < MAX_ROUND) {
        return NextResponse.json({ error: 'Cannot finish before completing all rounds' }, { status: 400 });
      }
      const finishResult = await sql<{ id: number }>`
        UPDATE games SET status = 'finished', current_round = 5 WHERE id = ${gameId}
        RETURNING id
      `;
      console.log('[round] finish UPDATE rows:', finishResult.rows);
      const updated = await getGameById(gameId);
      console.log('[round] game finished, updated:', updated);
      return NextResponse.json({ game: updated });
    }

    // Advance to next round
    const nextRound = game.current_round + 1;
    console.log('[round] advancing to nextRound:', nextRound);

    if (nextRound > MAX_ROUND) {
      return NextResponse.json({ error: 'All rounds already completed' }, { status: 409 });
    }

    // If ending round 3 (prompt writing), run LLM scoring first
    let scoringResult: { scored: number; failed: number; firstError?: string } | undefined;
    if (game.current_round === 3 && game.status === 'active') {
      // Set status to 'scoring' to prevent double-clicks
      await sql`UPDATE games SET status = 'scoring' WHERE id = ${gameId}`;

      try {
        scoringResult = await scoreRound3(gameId);
        if (scoringResult.failed > 0) {
          console.error(
            `[round] LLM scoring: ${scoringResult.scored} succeeded, ${scoringResult.failed} failed. First error: ${scoringResult.firstError}`
          );
        } else {
          console.log(`[round] LLM scoring complete: ${scoringResult.scored} answers scored.`);
        }
      } catch (err) {
        console.error('LLM scoring threw unexpectedly:', err);
        // Reset status so teacher can try again
        await sql`UPDATE games SET status = 'active' WHERE id = ${gameId}`;
        return NextResponse.json({ error: 'LLM scoring failed, please try again' }, { status: 500 });
      }
    }

    // Move to next round — use RETURNING to verify the UPDATE actually ran
    console.log('[round] running UPDATE: current_round =', nextRound, 'WHERE id =', gameId);
    const updateResult = await sql<{ id: number; current_round: number; status: string }>`
      UPDATE games SET current_round = ${nextRound}, status = 'active' WHERE id = ${gameId}
      RETURNING id, current_round, status
    `;
    console.log('[round] UPDATE RETURNING rows:', updateResult.rows);

    if (updateResult.rows.length === 0) {
      console.error('[round] UPDATE matched 0 rows — gameId may be wrong:', gameId);
      return NextResponse.json(
        { error: `Game update failed: no game found with id=${gameId}` },
        { status: 500 }
      );
    }

    const updated = await getGameById(gameId);
    console.log('[round] updated game:', updated);
    return NextResponse.json({ game: updated, scoringResult: scoringResult ?? null });
  } catch (err) {
    console.error('POST /api/games/[id]/round error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function scoreRound3(
  gameId: number
): Promise<{ scored: number; failed: number; firstError?: string }> {
  // Get the prompt writing question with rubric
  const questionResult = await sql<Question>`
    SELECT * FROM questions WHERE round_number = 3 AND question_type = 'prompt_writing' LIMIT 1
  `;
  const question = questionResult.rows[0];
  if (!question || !question.rubric) {
    console.error('[scoreRound3] No prompt_writing question with rubric found — skipping LLM scoring.');
    return { scored: 0, failed: 0, firstError: 'No rubric found for Round 3 question' };
  }

  // Get all unscored prompt answers for this game
  const answersResult = await sql<Answer>`
    SELECT * FROM answers
    WHERE game_id = ${gameId}
      AND round_number = 3
      AND score IS NULL
  `;

  let scored = 0;
  let failed = 0;
  let firstError: string | undefined;

  // Score each answer in parallel, tracking successes and failures
  await Promise.all(
    answersResult.rows.map(async (answer) => {
      try {
        const { score, rationale } = await scorePromptWriting(answer.answer_text, question.rubric!);
        await sql`
          UPDATE answers
          SET score = ${score}, scored_at = NOW()
          WHERE id = ${answer.id}
        `;
        console.log(`[scoreRound3] Scored student ${answer.student_id}: ${score}/20 — ${rationale}`);
        scored++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[scoreRound3] Scoring failed for answer ${answer.id}:`, err);
        if (!firstError) firstError = msg;
        failed++;
        // Assign 0 on failure so the game can still advance
        await sql`
          UPDATE answers SET score = 0, scored_at = NOW() WHERE id = ${answer.id}
        `;
      }
    })
  );

  return { scored, failed, firstError };
}
