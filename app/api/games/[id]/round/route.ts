import { NextRequest, NextResponse } from 'next/server';
import { getTeacherFromCookies } from '@/lib/auth';
import { getGameById, sql } from '@/lib/db';
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

  if (!teacher) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = params;
    const gameId = parseInt(id, 10);

    if (isNaN(gameId)) {
      return NextResponse.json({ error: 'Invalid game ID' }, { status: 400 });
    }

    const game = await getGameById(gameId);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Use Number() to handle potential string/number type mismatch from DB
    if (Number(game.teacher_id) !== Number(teacher.teacherId)) {
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

    // Finish the game
    if (action === 'finish') {
      if (game.current_round < MAX_ROUND) {
        return NextResponse.json({ error: 'Cannot finish before completing all rounds' }, { status: 400 });
      }
      await sql<{ id: number }>`
        UPDATE games SET status = 'finished', current_round = 5 WHERE id = ${gameId}
        RETURNING id
      `;
      const updated = await getGameById(gameId);
      return NextResponse.json({ game: updated });
    }

    // Advance to next round
    const nextRound = game.current_round + 1;

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
        }
      } catch (err) {
        console.error('LLM scoring threw unexpectedly:', err);
        // Reset status so teacher can try again
        await sql`UPDATE games SET status = 'active' WHERE id = ${gameId}`;
        return NextResponse.json({ error: 'LLM scoring failed, please try again' }, { status: 500 });
      }
    }

    // Move to next round
    const updateResult = await sql<{ id: number }>`
      UPDATE games SET current_round = ${nextRound}, status = 'active' WHERE id = ${gameId}
      RETURNING id
    `;

    if (updateResult.rows.length === 0) {
      return NextResponse.json(
        { error: `Game update failed: no game found with id=${gameId}` },
        { status: 500 }
      );
    }

    const updated = await getGameById(gameId);
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
        const { score } = await scorePromptWriting(answer.answer_text, question.rubric!);
        await sql`
          UPDATE answers
          SET score = ${score}, scored_at = NOW()
          WHERE id = ${answer.id}
        `;
        scored++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
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
