/**
 * The AI steps of the pipeline (spec §7 steps 6–8).
 *
 * Three separate calls, for three separate reasons:
 *   1. generate:  write the affirmative and the counter-wording of a fact
 *   2. verify:    read a card *without its label* and say whether it is true
 *   3. translate: reword it in another language, then verify that too
 *
 * The verification pass is blind on purpose. Negation is where truth-value
 * inversion happens most often, and translation is where it happens second
 * most often; a card whose stored answer is wrong is the worst possible
 * outcome at evaluation time, so anything the blind pass disagrees with goes
 * to a manual review queue instead of into the card set.
 */
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';
const BATCH_SIZE = 20;
function apiKey() {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
        throw new Error('ANTHROPIC_API_KEY is not set. The AI steps need it; the committed card set does not.');
    }
    return key;
}
async function complete(system, user, maxTokens = 4096) {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey(),
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: maxTokens,
            temperature: 0,
            system,
            messages: [{ role: 'user', content: user }],
        }),
    });
    if (!response.ok) {
        throw new Error(`Anthropic API ${response.status}: ${await response.text()}`);
    }
    const payload = (await response.json());
    return payload.content.map((block) => block.text ?? '').join('');
}
/** Models like to wrap JSON in prose or fences; take the outermost array. */
function extractJson(text) {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1)
        throw new Error(`No JSON array in model output: ${text.slice(0, 200)}`);
    return JSON.parse(text.slice(start, end + 1));
}
const GENERATE_SYSTEM = `You rewrite trivia knowledge into pairs of statements for a myth-or-truth card game.

For each item you receive an id and a piece of knowledge. Produce exactly two statements:
- "affirmative": a natural, self-contained sentence that is TRUE.
- "negated": a natural, self-contained sentence about the same knowledge that is FALSE.

Rules that matter:
- Build the false statement by SUBSTITUTING the key value with a plausible wrong one, not by inserting "not". If every false card contained the word "not", players would win by scanning for it rather than by knowing anything.
- Both sentences must read as ordinary statements of fact. Neither may hint at which is which.
- Keep each under 22 words. No questions, no "which of the following", no references to options.
- Use no proper names of private individuals. Public figures in a historical or professional role are fine.
- If the knowledge is too vague or unstable to state as a durable fact, set both fields to the empty string.

Reply with a JSON array only: [{"id": "...", "affirmative": "...", "negated": "..."}]`;
export async function generateCards(items) {
    const out = [];
    for (let index = 0; index < items.length; index += BATCH_SIZE) {
        const batch = items.slice(index, index + BATCH_SIZE);
        const prompt = batch
            .map((item) => `id: ${item.id}\nknowledge: ${item.knowledge}` +
            (item.distractor ? `\nplausible wrong value: ${item.distractor}` : ''))
            .join('\n\n');
        const raw = await complete(GENERATE_SYSTEM, prompt);
        const parsed = extractJson(raw);
        out.push(...parsed.filter((card) => card.affirmative && card.negated));
    }
    return out;
}
const VERIFY_SYSTEM = `You are fact-checking statements for a trivia game.

For each statement, decide whether it is true or false on its own terms, using only well-established general knowledge. You are NOT told what the game believes the answer to be. Judge independently.

Reply with a JSON array only: [{"id": "...", "believesTrue": true|false, "confidence": "high"|"medium"|"low"}]`;
/**
 * The blind pass. Callers must not include the stored label in `statement`,
 * which is the entire point of the step.
 */
export async function verifyCards(items) {
    const out = [];
    for (let index = 0; index < items.length; index += BATCH_SIZE) {
        const batch = items.slice(index, index + BATCH_SIZE);
        const prompt = batch.map((item) => `id: ${item.id}\nstatement: ${item.statement}`).join('\n\n');
        const raw = await complete(VERIFY_SYSTEM, prompt);
        out.push(...extractJson(raw));
    }
    return out;
}
const TRANSLATE_SYSTEM = (locale) => `You translate trivia statements into ${locale}.

Rules:
- Preserve the truth value exactly. A translation that flips the meaning is the worst possible error.
- Keep the register plain and the sentence natural in the target language; do not translate word for word.
- Keep proper nouns in their usual form in the target language.
- A term of art keeps the term the field actually uses in the target language,
  which is often the English word left alone. Never fall back to the everyday
  sense of the word: a password "salt" is not table salt, a "cookie" is not a
  biscuit, a "bug" is not an insect, a "key" is not a door key.
- Use one rendering of a term throughout; a fact and its false twin must not
  word the same concept two different ways.
- Keep it under 25 words.

Reply with a JSON array only: [{"id": "...", "text": "..."}]`;
export async function translateCards(items, locale) {
    const out = [];
    for (let index = 0; index < items.length; index += BATCH_SIZE) {
        const batch = items.slice(index, index + BATCH_SIZE);
        const prompt = batch.map((item) => `id: ${item.id}\ntext: ${item.text}`).join('\n\n');
        const raw = await complete(TRANSLATE_SYSTEM(locale), prompt);
        out.push(...extractJson(raw));
    }
    return out;
}
