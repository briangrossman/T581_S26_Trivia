/**
 * Database seed script.
 * Run with: npm run seed
 * Requires POSTGRES_URL and TEACHER_PASSWORD environment variables.
 */

import { neon } from '@neondatabase/serverless';

// Simple wrapper so seed uses the same { rows } interface as the rest of the app
const _db = neon(process.env.POSTGRES_URL!);
const sql = async <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...values: any[]
): Promise<{ rows: T[] }> => {
  const result = await _db(strings, ...values);
  return { rows: result as T[] };
};
import bcrypt from 'bcryptjs';

async function createSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS teachers (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS games (
      id            SERIAL PRIMARY KEY,
      teacher_id    INTEGER NOT NULL REFERENCES teachers(id),
      join_code     CHAR(6) UNIQUE NOT NULL,
      current_round INTEGER NOT NULL DEFAULT 0,
      status        VARCHAR(20) NOT NULL DEFAULT 'lobby',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_games_join_code ON games(join_code)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS students (
      id         SERIAL PRIMARY KEY,
      game_id    INTEGER NOT NULL REFERENCES games(id),
      username   VARCHAR(50) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(game_id, username)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_students_game_id ON students(game_id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS questions (
      id             SERIAL PRIMARY KEY,
      round_number   INTEGER NOT NULL,
      question_type  VARCHAR(20) NOT NULL,
      question_text  TEXT NOT NULL,
      option_a       TEXT,
      option_b       TEXT,
      option_c       TEXT,
      option_d       TEXT,
      correct_answer VARCHAR(10),
      correct_value  TEXT,
      rubric         TEXT,
      display_order  INTEGER NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS answers (
      id           SERIAL PRIMARY KEY,
      student_id   INTEGER NOT NULL REFERENCES students(id),
      game_id      INTEGER NOT NULL REFERENCES games(id),
      question_id  INTEGER NOT NULL REFERENCES questions(id),
      round_number INTEGER NOT NULL,
      answer_text  TEXT NOT NULL,
      score        NUMERIC(6,2),
      is_correct   BOOLEAN,
      scored_at    TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(student_id, question_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_answers_game_id      ON answers(game_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_answers_student_id   ON answers(student_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_answers_round        ON answers(game_id, round_number)
  `;

  console.log('Schema created.');
}

async function seedTeacher() {
  const password = process.env.TEACHER_PASSWORD;
  if (!password) {
    throw new Error('TEACHER_PASSWORD environment variable is required');
  }
  const hash = await bcrypt.hash(password, 12);
  await sql`
    INSERT INTO teachers (username, password_hash)
    VALUES ('teacher', ${hash})
    ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
  `;
  console.log('Teacher account seeded (username: teacher).');
}

async function seedQuestions() {
  // Check if already seeded
  const existing = await sql`SELECT COUNT(*) as count FROM questions`;
  if (Number(existing.rows[0].count) > 0) {
    console.log('Questions already seeded — skipping.');
    return;
  }

  const round3Rubric = `Rubric: Evaluate the quality of a user-written prompt whose goal is to instruct an AI to create the following application: Create a to-do list application that allows users to save and track multiple lists.

Scoring Method:
Evaluate the prompt across five criteria. Each criterion receives a score from 0 to 5.
Score meanings: 0-1 = missing or very weak, 2-3 = partially specified, 4-5 = clear and well described.
Total Raw Score Range: 0-25.
Final Score Calculation: Final Score = (Raw Score / 25) * 20. Round to the nearest whole number.

Criterion 1: Task Clarity
Evaluate whether the prompt clearly states the goal of creating a to-do list application that supports multiple lists and allows tasks to be tracked within those lists.
Score guidance: 0-1 vague goal (example: make a to-do app). 2-3 mentions to-do lists but lacks clarity or detail. 4-5 clearly describes a multi-list to-do system and the purpose of the application.

Criterion 2: Feature Specification
Evaluate whether the prompt describes actions users should be able to perform. Relevant features may include creating lists, adding tasks, editing tasks, deleting tasks, marking tasks complete, or deleting lists.
Score guidance: 0-1 few or no features described. 2-3 some basic functionality mentioned. 4-5 clearly specifies multiple core features for managing lists and tasks.

Criterion 3: User Interaction and UX Description
Evaluate whether the prompt explains how users interact with the application. Examples include layout ideas, navigation between lists, task display, or interface controls such as buttons.
Score guidance: 0-1 no description of interaction or interface. 2-3 basic UI elements mentioned. 4-5 clear description of user workflow or layout.

Criterion 4: Data and Persistence
Evaluate whether the prompt specifies that tasks and lists should be saved so they persist between sessions or page refreshes.
Score guidance: 0-1 no mention of saving data. 2-3 vague reference to storing data. 4-5 clearly states that lists and tasks should persist or be stored.

Criterion 5: Structure and Organization
Evaluate whether the prompt is organized in a way that helps an AI interpret it effectively. Well-structured prompts may use bullet points, sections, logical ordering, or concise wording.
Score guidance: 0-1 disorganized or unclear prompt. 2-3 moderately structured. 4-5 well organized and easy to interpret.

Output Expectations:
Return a score for each criterion, a raw score out of 25, and a final score out of 20 using the formula above.`;

  const questions = [
    // Round 1 — Multiple Choice (5 questions, 4 pts each)
    {
      round_number: 1, question_type: 'multiple_choice', display_order: 1,
      question_text: 'What does "vibe coding" usually mean?',
      option_a: 'Writing code as fast as possible',
      option_b: 'Building software by describing intent to AI and iterating',
      option_c: 'Coding without debugging',
      option_d: 'Copy-pasting code from StackOverflow',
      correct_answer: 'B', correct_value: null, rubric: null,
    },
    {
      round_number: 1, question_type: 'multiple_choice', display_order: 2,
      question_text: 'You prompt an AI to build a feature, but the UI looks wrong. What\'s the best next step?',
      option_a: 'Rewrite everything manually',
      option_b: 'Delete the project',
      option_c: 'Give the AI a more specific prompt describing the UI',
      option_d: 'Wait and hope it fixes itself',
      correct_answer: 'C', correct_value: null, rubric: null,
    },
    {
      round_number: 1, question_type: 'multiple_choice', display_order: 3,
      question_text: "Where do the 'pages' of a website live so they can be shared with people over the internet?",
      option_a: 'Server',
      option_b: 'Router',
      option_c: 'Browser',
      option_d: 'Baking drawer next to the wisk',
      correct_answer: 'A', correct_value: null, rubric: null,
    },
    {
      round_number: 1, question_type: 'multiple_choice', display_order: 4,
      question_text: 'Which problem does Git help you solve?',
      option_a: 'Help with brainstorming ideas',
      option_b: 'Writing code for you',
      option_c: 'Crippling social anxiety',
      option_d: 'Multiple people working on a project concurrently',
      correct_answer: 'D', correct_value: null, rubric: null,
    },
    {
      round_number: 1, question_type: 'multiple_choice', display_order: 5,
      question_text: 'Which of the following would not necessarily require a database to build?',
      option_a: 'A website that streams CSPAN news 24-7',
      option_b: 'A user login system',
      option_c: 'A trivia game for an EdTech course that tracks students answers',
      option_d: 'A site that stores historical weather data around the world',
      correct_answer: 'A', correct_value: null, rubric: null,
    },
    // Round 2 — Multiple Choice (5 questions, 4 pts each)
    {
      round_number: 2, question_type: 'multiple_choice', display_order: 1,
      question_text: 'What type of programming language is Scratch?',
      option_a: 'Text-based',
      option_b: 'Voice-based',
      option_c: 'Block-based',
      option_d: 'Spreadsheet-based',
      correct_answer: 'C', correct_value: null, rubric: null,
    },
    {
      round_number: 2, question_type: 'multiple_choice', display_order: 2,
      question_text: 'In Scratch, what are the characters or objects in a project called?',
      option_a: 'Actors',
      option_b: 'Sprites',
      option_c: 'Avatars',
      option_d: 'Blocks',
      correct_answer: 'B', correct_value: null, rubric: null,
    },
    {
      round_number: 2, question_type: 'multiple_choice', display_order: 3,
      question_text: 'Which Scratch block starts many programs?',
      option_a: 'When flag clicked',
      option_b: 'Start program',
      option_c: 'Begin game',
      option_d: 'Run code',
      correct_answer: 'A', correct_value: null, rubric: null,
    },
    {
      round_number: 2, question_type: 'multiple_choice', display_order: 4,
      question_text: 'Which Scratch block lets you repeat commands over and over?',
      option_a: 'list',
      option_b: 'variable',
      option_c: 'repeat',
      option_d: 'glide',
      correct_answer: 'C', correct_value: null, rubric: null,
    },
    {
      round_number: 2, question_type: 'multiple_choice', display_order: 5,
      question_text: 'Which Scratch blocks allow you to tell other commands to run at particular times?',
      option_a: 'send & get',
      option_b: 'confide in & pretend you hear but you\'re too busy doomsrolling',
      option_c: 'speak & listen',
      option_d: 'broadcast & receive',
      correct_answer: 'D', correct_value: null, rubric: null, // CSV had empty — treated as D
    },
    // Round 3 — Prompt Writing (1 question, LLM scores 0-20)
    {
      round_number: 3, question_type: 'prompt_writing', display_order: 1,
      question_text: 'Write a prompt to create a to-do list application that allows users to save and track multiple lists.',
      option_a: null, option_b: null, option_c: null, option_d: null,
      correct_answer: null, correct_value: null,
      rubric: round3Rubric,
    },
    // Round 4 — Coding (2 questions, 10 pts each)
    {
      round_number: 4, question_type: 'coding', display_order: 1,
      question_text: 'Write a program or instruct an LLM to count the number of prime numbers between 1,000 and 9,000. Submit the answer below.',
      option_a: null, option_b: null, option_c: null, option_d: null,
      correct_answer: null, correct_value: '949', rubric: null,
    },
    {
      round_number: 4, question_type: 'coding', display_order: 2,
      question_text: 'Write a program or instruct an LLM to compute the following: You put $1,000 in the bank. Each month, it earns 1% interest. How much money will you have in the bank after 31 years?',
      option_a: null, option_b: null, option_c: null, option_d: null,
      correct_answer: null, correct_value: '$40,508.96', rubric: null,
    },
  ];

  for (const q of questions) {
    await sql`
      INSERT INTO questions (
        round_number, question_type, question_text,
        option_a, option_b, option_c, option_d,
        correct_answer, correct_value, rubric, display_order
      ) VALUES (
        ${q.round_number}, ${q.question_type}, ${q.question_text},
        ${q.option_a}, ${q.option_b}, ${q.option_c}, ${q.option_d},
        ${q.correct_answer}, ${q.correct_value}, ${q.rubric}, ${q.display_order}
      )
    `;
  }

  console.log(`Questions seeded: ${questions.length} questions across 4 rounds.`);
}

async function main() {
  console.log('Starting database seed...');
  await createSchema();
  await seedTeacher();
  await seedQuestions();
  console.log('Seed complete!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
