import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

export interface ScoringResult {
  score: number;    // 0-20
  rationale: string;
}

export async function scorePromptWriting(
  studentPrompt: string,
  rubric: string
): Promise<ScoringResult> {
  const userMessage = `${rubric}

Student Submission:
"""
${studentPrompt}
"""

Evaluate the submission using the rubric above. Return your response as a JSON object with this exact shape (no markdown, just raw JSON):
{
  "criterion_1_score": <integer 0-5>,
  "criterion_2_score": <integer 0-5>,
  "criterion_3_score": <integer 0-5>,
  "criterion_4_score": <integer 0-5>,
  "criterion_5_score": <integer 0-5>,
  "raw_score": <integer 0-25>,
  "final_score": <integer 0-20>,
  "rationale": "<one or two sentence explanation>"
}`;

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 600,
    system:
      'You are an educational evaluator scoring student-written prompts. Follow the rubric precisely and return only valid JSON with no markdown formatting.',
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';

  // Strip any markdown code fences if present
  const cleaned = text.replace(/```(?:json)?\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);

  const finalScore = Math.max(0, Math.min(20, Math.round(Number(parsed.final_score) || 0)));
  const rationale = String(parsed.rationale || '');

  return { score: finalScore, rationale };
}
