import type { Question } from './types';

const ROUND_TOTAL = 20;

export function scoreMC(
  studentAnswer: string,
  correctAnswer: string,
  numQuestionsInRound: number
): { score: number; is_correct: boolean } {
  const pointsPerQuestion = ROUND_TOTAL / numQuestionsInRound;
  const is_correct = studentAnswer.trim().toUpperCase() === correctAnswer.trim().toUpperCase();
  return { score: is_correct ? pointsPerQuestion : 0, is_correct };
}

function normalizeCodingAnswer(raw: string): number {
  // Remove $, commas, and whitespace, then parse as float
  const cleaned = raw.replace(/[$,\s]/g, '');
  return parseFloat(cleaned);
}

export function scoreCoding(
  studentAnswer: string,
  correctValue: string,
  numQuestionsInRound: number
): { score: number; is_correct: boolean } {
  const pointsPerQuestion = ROUND_TOTAL / numQuestionsInRound;

  const studentNum = normalizeCodingAnswer(studentAnswer);
  const correctNum = normalizeCodingAnswer(correctValue);

  // Use tolerance of 0.01 for floating-point comparison (currency rounding)
  const tolerance = 0.01;
  const is_correct =
    !isNaN(studentNum) && !isNaN(correctNum) && Math.abs(studentNum - correctNum) <= tolerance;

  return { score: is_correct ? pointsPerQuestion : 0, is_correct };
}

// Returns score result for MC or coding questions, or null if prompt writing (scored by LLM later)
export function scoreAnswer(
  question: Question,
  studentAnswer: string,
  numQuestionsInRound: number
): { score: number; is_correct: boolean } | null {
  if (question.question_type === 'multiple_choice') {
    if (!question.correct_answer) {
      // Missing correct answer — give full credit
      return { score: ROUND_TOTAL / numQuestionsInRound, is_correct: true };
    }
    return scoreMC(studentAnswer, question.correct_answer, numQuestionsInRound);
  }

  if (question.question_type === 'coding') {
    if (!question.correct_value) {
      return { score: ROUND_TOTAL / numQuestionsInRound, is_correct: true };
    }
    return scoreCoding(studentAnswer, question.correct_value, numQuestionsInRound);
  }

  // prompt_writing — scored by LLM when teacher ends the round
  return null;
}
