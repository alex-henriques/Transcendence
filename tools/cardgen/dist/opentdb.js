import { createHash } from 'node:crypto';
/**
 * Client for the Open Trivia Database.
 *
 * Two things matter here and nowhere else in the project: the rate limit (one
 * request per five seconds) and the session token, which is what stops the API
 * returning the same question twice inside a run.
 */
const BASE = 'https://opentdb.com';
/** OpenTDB rejects anything faster than one request per five seconds. */
const MIN_INTERVAL_MS = 5_200;
let lastRequestAt = 0;
async function throttled(url) {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0)
        await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    const response = await fetch(url, { headers: { 'User-Agent': 'wkb-cardgen/1.0' } });
    if (!response.ok)
        throw new Error(`OpenTDB ${response.status} for ${url}`);
    return (await response.json());
}
export async function globalCounts() {
    return throttled(`${BASE}/api_count_global.php`);
}
export async function categories() {
    return throttled(`${BASE}/api_category.php`);
}
export async function categoryCount(id) {
    const payload = await throttled(`${BASE}/api_count.php?category=${id}`);
    return payload.category_question_count.total_question_count;
}
/** A session token makes the API skip questions already returned in this run. */
export async function newSessionToken() {
    const payload = await throttled(`${BASE}/api_token.php?command=request`);
    return payload.token;
}
export async function fetchQuestions(params) {
    const query = new URLSearchParams({
        amount: String(Math.min(50, params.amount)),
        token: params.token,
        encode: 'url3986',
    });
    if (params.categoryId)
        query.set('category', String(params.categoryId));
    if (params.type)
        query.set('type', params.type);
    const payload = await throttled(`${BASE}/api.php?${query.toString()}`);
    return {
        responseCode: payload.response_code,
        questions: (payload.results ?? []).map((question) => ({
            ...question,
            question: decodeURIComponent(question.question),
            correct_answer: decodeURIComponent(question.correct_answer),
            incorrect_answers: question.incorrect_answers.map((answer) => decodeURIComponent(answer)),
            category: decodeURIComponent(question.category),
        })),
    };
}
/**
 * A stable identifier for a question, so re-collecting can be deduplicated and
 * a fact can always be traced back to the exact wording it came from.
 */
export function questionId(question) {
    return createHash('sha256')
        .update(`${question.question}|${question.correct_answer}`)
        .digest('hex');
}
