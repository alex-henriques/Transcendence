import { questionId } from './opentdb.js';
import { checkStability, isConvertible, isSensitive } from './filters.js';
/**
 * Turns collected questions into facts (spec §7 step 4).
 *
 * A fact is one unit of knowledge. A multiple-choice question yields exactly
 * ONE fact, never one per wrong option. All four options are the same piece of
 * knowledge, and a player who knows it answers every variant without thinking.
 */
/** Maps OpenTDB's 24 narrow categories onto the eight the game uses. */
export const MACRO_CATEGORIES = {
    'General Knowledge': 'culture',
    'Entertainment: Books': 'arts',
    'Entertainment: Film': 'arts',
    'Entertainment: Music': 'arts',
    'Entertainment: Musicals & Theatres': 'arts',
    'Entertainment: Television': 'arts',
    'Entertainment: Video Games': 'technology',
    'Entertainment: Board Games': 'sports',
    'Entertainment: Comics': 'arts',
    'Entertainment: Japanese Anime & Manga': 'arts',
    'Entertainment: Cartoon & Animations': 'arts',
    'Science & Nature': 'science',
    'Science: Computers': 'technology',
    'Science: Mathematics': 'science',
    'Science: Gadgets': 'technology',
    Mythology: 'culture',
    Sports: 'sports',
    Geography: 'geography',
    History: 'history',
    Politics: 'history',
    Art: 'arts',
    Celebrities: 'culture',
    Animals: 'science',
    Vehicles: 'technology',
};
export function convert(questions) {
    const facts = [];
    const skipped = new Map();
    const seenIds = new Set();
    const skip = (reason) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
    for (const question of questions) {
        const id = questionId(question);
        if (seenIds.has(id)) {
            skip('duplicate');
            continue;
        }
        seenIds.add(id);
        const categorySlug = MACRO_CATEGORIES[question.category];
        if (!categorySlug) {
            skip('category not mapped');
            continue;
        }
        if (isSensitive(question.question) || isSensitive(question.correct_answer)) {
            skip('sensitive wording');
            continue;
        }
        const flags = [];
        const stability = checkStability(`${question.question} ${question.correct_answer}`);
        if (!stability.stable)
            flags.push(...stability.reasons);
        if (question.type === 'boolean') {
            // A boolean question is already a statement; its truth value is the
            // answer, so the proposition is the statement in its true orientation.
            const isTrue = question.correct_answer.toLowerCase() === 'true';
            facts.push({
                id,
                categorySlug,
                difficulty: question.difficulty,
                proposition: isTrue ? question.question : `NOT: ${question.question}`,
                distractor: null,
                sourceRef: `opentdb:${id}`,
                origin: 'boolean',
                flags,
            });
            continue;
        }
        if (!isConvertible(question.question)) {
            skip('question depends on its options');
            continue;
        }
        // One fact, one distractor. The remaining wrong options are discarded on
        // purpose: they would be the same fact wearing a different hat.
        const distractor = question.incorrect_answers[0] ?? null;
        facts.push({
            id,
            categorySlug,
            difficulty: question.difficulty,
            proposition: `${question.question} -> ${question.correct_answer}`,
            distractor,
            sourceRef: `opentdb:${id}`,
            origin: 'multiple',
            flags,
        });
    }
    return {
        seen: questions.length,
        facts,
        skipped: [...skipped.entries()]
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count),
    };
}
