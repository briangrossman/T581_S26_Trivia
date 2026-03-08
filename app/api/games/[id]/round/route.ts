import { NextRequest, NextResponse } from 'next/server';
import { getTeacherFromCookies } from '@/lib/auth';
import { getGameById, sql } from '@/lib/db';
import { scorePromptWriting } from '@/lib/claude';
import type { Question, Answer } from '@/lib/types';

const MAX_ROUND = 4;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await getTeacherFromCookies();
  if (!teacher) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const gameId = parseInt(id, 10);
    const game = await getGameById(gameId);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (game.teacher_id !== teacher.teacherId) {
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
      await sql`
        UPDATE games SET status = 'finished', current_round = 5 WHERE id = ${gameId}
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
    if (game.current_round === 3 && game.status === 'active') {
      // Set status to 'scoring' to prevent double-clicks
      await sql`UPDATE games SET status = 'scoring' WHERE id = ${gameId}`;

      try {
        await scoreRound3(gameId);
      } catch (err) {
        console.error('LLM scoring failed:', err);
        // Reset status so teacher can try again or proceed anyway
        await sql`UPDATE games SET status = 'active' WHERE id = ${gameId}`;
        return NextResponse.json({ error: 'LLM scoring failed, please try again' }, { status: 500 });
      }
    }

    // Move to next round
    await sql`
      UPDATE games SET current_round = ${nextRound}, status = 'active' WHERE id = ${gameId}
    `;

    const updated = await getGameById(gameId);
    return NextResponse.json({ game: updated });
  } catch (err) {
    console.error('POST /api/games/[id]/round error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function scoreRound3(gameId: number): Promise<void> {
  // Get the prompt writing question with rubric
  const questionResult = await sql<Question>`
    SELECT * FROM questions WHERE round_number = 3 AND question_type = 'prompt_writing' LIMIT 1
  `;
  const question = questionResult.rows[0];
  if (!question || !question.rubric) return;

  // Get all unscored prompt answers for this game
  const answersResult = await sql<Answer>`
    SELECT * FROM answers
    WHERE game_id = ${gameId}
      AND round_number = 3
      AND score IS NULL
  `;

  // Score each answer in parallel
  await Promise.all(
    answersResult.rows.map(async (answer) => {
      try {
        const { score, rationale } = await scorePromptWriting(answer.answer_text, question.rubric!);
        await sql`
          UPDATE answers
          SET score = ${score}, scored_at = NOW()
          WHERE id = ${answer.id}
        `;
        // Store rationale in a comment (log only — no dedicated column)
        console.log(`Scored student ${answer.student_id}: ${score}/20 — ${rationale}`);
      } catch (err) {
        console.error(`Scoring failed for answer ${answer.id}:`, err);
        // Assign 0 on failure so it doesn't block the game
        await sql`
          UPDATE answers SET score = 0, scored_at = NOW() WHERE id = ${answer.id}
        `;
      }
    })
  );
}
