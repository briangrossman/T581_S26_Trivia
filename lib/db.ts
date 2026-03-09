import { neon } from '@neondatabase/serverless';
import type { Game, Student, Question, Answer, StudentQuestion, StudentScore } from './types';

// Neon's sql tag returns rows as a plain array. We wrap it to return { rows }
// so the rest of the codebase uses a consistent interface.
type SqlTag = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...values: any[]
) => Promise<{ rows: T[] }>;

// Lazy singleton — only create the Neon client when first query is run,
// not at module import time (which would fail during Next.js build without POSTGRES_URL).
let _db: ReturnType<typeof neon> | null = null;

/**
 * @neondatabase/serverless's HTTP driver requires the *direct* (non-pooler)
 * endpoint. The Vercel-Neon integration often sets POSTGRES_URL to the
 * PgBouncer pooler URL (hostname contains "-pooler"), which causes
 * inconsistent read-after-write behaviour: writes commit but subsequent
 * reads from a different HTTP connection return stale data.
 *
 * We strip "-pooler" from the hostname to obtain the direct endpoint URL.
 * e.g. ep-foo-pooler.us-east-1.aws.neon.tech → ep-foo.us-east-1.aws.neon.tech
 */
function getNeonUrl(): string {
  const url = process.env.POSTGRES_URL!;
  // Replace "-pooler." with "." only in the hostname portion of the URL.
  return url.replace(/-pooler(\.[^/]+\.aws\.neon\.tech)/, '$1');
}

function getDb(): ReturnType<typeof neon> {
  if (!_db) {
    _db = neon(getNeonUrl());
  }
  return _db;
}

export const sql: SqlTag = async <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...values: any[]
): Promise<{ rows: T[] }> => {
  const result = await getDb()(strings, ...values);
  return { rows: result as T[] };
};

// ---- Query Helpers ----

export async function getGameByCode(code: string): Promise<Game | null> {
  const result = await sql<Game>`
    SELECT * FROM games WHERE join_code = ${code.toUpperCase()} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function getGameById(id: number): Promise<Game | null> {
  const result = await sql<Game>`
    SELECT * FROM games WHERE id = ${id} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function getTeacherGames(teacherId: number): Promise<(Game & { student_count: number })[]> {
  const result = await sql<Game & { student_count: number }>`
    SELECT g.*, COUNT(s.id)::int as student_count
    FROM games g
    LEFT JOIN students s ON s.game_id = g.id
    WHERE g.teacher_id = ${teacherId}
    GROUP BY g.id
    ORDER BY g.created_at DESC
  `;
  return result.rows;
}

export async function getStudentsByGame(gameId: number): Promise<Student[]> {
  const result = await sql<Student>`
    SELECT * FROM students WHERE game_id = ${gameId} ORDER BY created_at ASC
  `;
  return result.rows;
}

export async function getQuestionsForRound(
  roundNumber: number,
  forTeacher = false
): Promise<Question[] | StudentQuestion[]> {
  if (forTeacher) {
    const result = await sql<Question>`
      SELECT * FROM questions WHERE round_number = ${roundNumber} ORDER BY display_order ASC
    `;
    return result.rows;
  }
  const result = await sql<StudentQuestion>`
    SELECT id, round_number, question_type, question_text,
           option_a, option_b, option_c, option_d, display_order
    FROM questions
    WHERE round_number = ${roundNumber}
    ORDER BY display_order ASC
  `;
  return result.rows;
}

export async function getAllQuestions(): Promise<Question[]> {
  const result = await sql<Question>`
    SELECT * FROM questions ORDER BY round_number ASC, display_order ASC
  `;
  return result.rows;
}

export async function getAnswersByGame(gameId: number): Promise<Answer[]> {
  const result = await sql<Answer>`
    SELECT * FROM answers WHERE game_id = ${gameId} ORDER BY submitted_at ASC
  `;
  return result.rows;
}

export async function getStudentAnswers(studentId: number, gameId: number): Promise<Answer[]> {
  const result = await sql<Answer>`
    SELECT * FROM answers WHERE student_id = ${studentId} AND game_id = ${gameId}
    ORDER BY submitted_at ASC
  `;
  return result.rows;
}

export async function getRoundScores(gameId: number): Promise<StudentScore[]> {
  const result = await sql<StudentScore>`
    SELECT
      s.id as student_id,
      s.username,
      COALESCE(SUM(CASE WHEN a.round_number = 1 THEN a.score ELSE 0 END), 0)::float as round_1_score,
      COALESCE(SUM(CASE WHEN a.round_number = 2 THEN a.score ELSE 0 END), 0)::float as round_2_score,
      COALESCE(SUM(CASE WHEN a.round_number = 3 THEN a.score ELSE 0 END), 0)::float as round_3_score,
      COALESCE(SUM(CASE WHEN a.round_number = 4 THEN a.score ELSE 0 END), 0)::float as round_4_score,
      COALESCE(SUM(a.score), 0)::float as total_score
    FROM students s
    LEFT JOIN answers a ON a.student_id = s.id AND a.game_id = ${gameId}
    WHERE s.game_id = ${gameId}
    GROUP BY s.id, s.username
    ORDER BY total_score DESC
  `;
  return result.rows;
}

export async function getStudentByGameAndUsername(gameId: number, username: string): Promise<Student | null> {
  const result = await sql<Student>`
    SELECT * FROM students WHERE game_id = ${gameId} AND username = ${username} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function getStudentById(id: number): Promise<Student | null> {
  const result = await sql<Student>`
    SELECT * FROM students WHERE id = ${id} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function countStudents(gameId: number): Promise<number> {
  const result = await sql<{ count: number }>`
    SELECT COUNT(*)::int as count FROM students WHERE game_id = ${gameId}
  `;
  return result.rows[0]?.count ?? 0;
}
