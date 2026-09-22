import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_LOCALE, LOCALES } from '@mythos/shared';
import { prisma } from '../db.js';
import { hashPassword } from '../lib/password.js';
import { ACHIEVEMENTS, BOTS, DEMO_PASSWORD, DEMO_USERS, } from './data.js';
/**
 * Loads the committed card set and reference data.
 *
 * Every step is an upsert on a natural key, so running it twice changes
 * nothing. The container entrypoint runs it on every boot, which is what makes
 * `make` on a clean clone produce a playable game with no extra step.
 */
const FACTS_DIR = path.resolve(process.cwd(), 'prisma', 'seed', 'facts');
function isPair(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.t === 'string' &&
        typeof value.f === 'string');
}
async function seedCardSet() {
    let files;
    try {
        files = (await readdir(FACTS_DIR)).filter((f) => f.endsWith('.json')).sort();
    }
    catch {
        console.warn(`[seed] no card set found at ${FACTS_DIR}; skipping`);
        return { categories: 0, facts: 0, cards: 0, translations: 0 };
    }
    let facts = 0;
    let cards = 0;
    let translations = 0;
    for (const file of files) {
        const raw = await readFile(path.join(FACTS_DIR, file), 'utf8');
        const parsed = JSON.parse(raw);
        const category = await prisma.category.upsert({
            where: { slug: parsed.category.slug },
            create: { slug: parsed.category.slug, name: parsed.category.name },
            update: { name: parsed.category.name },
        });
        for (const entry of parsed.facts) {
            const sourceRef = `curated:${entry.ref}`;
            const base = entry[DEFAULT_LOCALE];
            if (!isPair(base)) {
                console.warn(`[seed] ${file}: ${entry.ref} has no ${DEFAULT_LOCALE} wording; skipped`);
                continue;
            }
            const fact = await prisma.facts.upsert({
                where: { sourceRef },
                create: {
                    categoryId: category.id,
                    difficulty: entry.difficulty,
                    sourceRef,
                    license: parsed.license,
                    verifiedAt: new Date(),
                    active: true,
                },
                update: {
                    categoryId: category.id,
                    difficulty: entry.difficulty,
                    license: parsed.license,
                },
            });
            facts += 1;
            // Two cards per fact: the affirmative wording is the true one, the
            // counter-wording is the false one. They are what makes an exact 50/50
            // draw possible without touching the card set's composition.
            for (const [form, text, isTrue] of [
                ['affirmative', base.t, true],
                ['negated', base.f, false],
            ]) {
                const card = await prisma.card.upsert({
                    where: { factId_form: { factId: fact.id, form } },
                    create: { factId: fact.id, text, isTrue, form },
                    update: { text, isTrue },
                });
                cards += 1;
                for (const locale of LOCALES) {
                    if (locale === DEFAULT_LOCALE)
                        continue;
                    const localised = entry[locale];
                    if (!isPair(localised))
                        continue;
                    const localisedText = form === 'affirmative' ? localised.t : localised.f;
                    await prisma.cardTranslation.upsert({
                        where: { cardId_locale: { cardId: card.id, locale } },
                        create: { cardId: card.id, locale, text: localisedText },
                        update: { text: localisedText },
                    });
                    translations += 1;
                }
            }
        }
    }
    return { categories: files.length, facts, cards, translations };
}
async function seedAchievements() {
    for (const achievement of ACHIEVEMENTS) {
        // The rule blob is opaque to Prisma; services/rewards.ts is what reads it.
        const criteria = achievement.criteria;
        await prisma.achievement.upsert({
            where: { slug: achievement.slug },
            create: {
                slug: achievement.slug,
                name: achievement.name,
                description: achievement.description,
                criteria,
            },
            update: { name: achievement.name, description: achievement.description, criteria },
        });
    }
    return ACHIEVEMENTS.length;
}
async function seedBots() {
    for (const bot of BOTS) {
        const email = `${bot.displayName.toLowerCase()}@bots.mythos.local`;
        const user = await prisma.user.upsert({
            where: { email },
            create: {
                email,
                displayName: bot.displayName,
                // A bot has no password hash, so the login route can never accept one.
                passwordHash: null,
                isBot: true,
                locale: DEFAULT_LOCALE,
            },
            update: { displayName: bot.displayName, isBot: true },
        });
        await prisma.botProfile.upsert({
            where: { userId: user.id },
            create: {
                userId: user.id,
                label: bot.label,
                accuracyByCategory: bot.accuracyByCategory,
                reactionMsMean: bot.reactionMsMean,
                reactionMsStddev: bot.reactionMsStddev,
            },
            update: {
                label: bot.label,
                accuracyByCategory: bot.accuracyByCategory,
                reactionMsMean: bot.reactionMsMean,
                reactionMsStddev: bot.reactionMsStddev,
            },
        });
    }
    return BOTS.length;
}
async function seedDemoUsers() {
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    for (const demo of DEMO_USERS) {
        await prisma.user.upsert({
            where: { email: demo.email },
            create: {
                email: demo.email,
                displayName: demo.displayName,
                passwordHash,
                locale: demo.locale,
            },
            // Do not reset the password of an account somebody has been using.
            update: { displayName: demo.displayName },
        });
    }
    return DEMO_USERS.length;
}
async function main() {
    const started = Date.now();
    const cardSet = await seedCardSet();
    const achievements = await seedAchievements();
    const bots = await seedBots();
    const demo = await seedDemoUsers();
    console.log(`[seed] ${cardSet.categories} categories · ${cardSet.facts} facts · ` +
        `${cardSet.cards} cards · ${cardSet.translations} translations · ` +
        `${achievements} achievements · ${bots} bots · ${demo} demo users ` +
        `(${Date.now() - started} ms)`);
}
main()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
    console.error('[seed] failed', error);
    await prisma.$disconnect();
    process.exit(1);
});
