export type GameStatus = 'lobby' | 'active' | 'scoring' | 'finished';
export type QuestionType = 'multiple_choice' | 'prompt_writing' | 'coding';

export interface Teacher {
  id: number;
  username: string;
  created_at: string;
}

export interface Game {
  id: number;
  teacher_id: number;
  join_code: string;
  current_round: number; // 0=lobby, 1-4=rounds, 5=finished
  status: GameStatus;
  created_at: string;
}

export interface Student {
  id: number;
  game_id: number;
  username: string;
  created_at: string;
}

export interface Question {
  id: number;
  round_number: number;
  question_type: QuestionType;
  question_text: string;
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  option_d?: string | null;
  correct_answer?: string | null; // hidden from students
  correct_value?: string | null;  // hidden from students
  rubric?: string | null;         // hidden from students
  display_order: number;
}

// Question without sensitive teacher-only fields
export type StudentQuestion = Omit<Question, 'correct_answer' | 'correct_value' | 'rubric'>;

export interface Answer {
  id: number;
  student_id: number;
  game_id: number;
  question_id: number;
  round_number: number;
  answer_text: string;
  score: number | null;
  is_correct: boolean | null;
  scored_at: string | null;
  submitted_at: string;
}

export interface StudentScore {
  student_id: number;
  username: string;
  round_1_score: number;
  round_2_score: number;
  round_3_score: number;
  round_4_score: number;
  total_score: number;
}

// Stored in localStorage for student session persistence
export interface StudentSession {
  studentId: number;
  gameId: number;
  gameCode: string;
  username: string;
}

export interface GameStateResponse {
  game: Pick<Game, 'id' | 'join_code' | 'current_round' | 'status'>;
  currentRoundQuestions: StudentQuestion[];
  studentAnswers?: Answer[];
  studentCount: number;
}

export interface TeacherGameResponse {
  game: Game;
  questions: Question[];
  students: Student[];
  answers: Answer[];
}
