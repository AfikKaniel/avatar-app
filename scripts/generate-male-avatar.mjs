/**
 * generate-male-avatar.mjs
 *
 * One-time script: takes the existing female avatar body, sends it to
 * Stability AI, generates a matching male version, and saves the result
 * to public/avatar_fullbody_male.jpg — which Vercel will serve at:
 *   https://avatar-app-gilt.vercel.app/avatar_fullbody_male.jpg
 *
 * Run: node scripts/generate-male-avatar.mjs
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STABILITY_KEY    = 'sk-hcPY009YWk4LOAYCDYwkFN7h6G5oKnDoKLqUgWkxkVQFmUHk';
const FEMALE_AVATAR_URL = 'https://d2xsxph8kpxj0f.cloudfront.net/310519663455478896/hfC5CQriRBzLePvxxawGyy/gaging_fullbody_avatar-NQcShgeKNUgUS3pfZoDULH.png';
const OUT_PATH         = path.join(__dirname, '..', 'public', 'avatar_fullbody_male.jpg');

async function main() {
    // ── Step 1: Download the female avatar ────────────────────────────────
    console.log('⬇  Downloading female avatar from CDN…');
    const femaleResp = await fetch(FEMALE_AVATAR_URL);
    if (!femaleResp.ok) throw new Error(`CDN fetch failed: ${femaleResp.status}`);
    const femaleBuffer = Buffer.from(await femaleResp.arrayBuffer());
    console.log(`   Got ${femaleBuffer.length} bytes`);

    // ── Step 2: Send to Stability AI SD3 Turbo ────────────────────────────
    console.log('🎨  Generating male version via Stability AI…');
    const form = new FormData();
    form.append('image',  new Blob([femaleBuffer], { type: 'image/png' }), 'female.png');
    form.append('prompt',
        'convert to athletic male figure, same futuristic sci-fi full-body suit with glowing ' +
        'circuit lines, same standing pose, same dark background with cyan and purple rim lighting, ' +
        'masculine build, bald head, same outfit style, no face visible, full body, high quality'
    );
    form.append('negative_prompt', 'female, woman, girl, long hair, feminine');
    form.append('mode',          'image-to-image');
    form.append('model',         'sd3-turbo');
    form.append('strength',      '0.72');   // higher = more male transformation
    form.append('output_format', 'jpeg');

    const stabilityResp = await fetch(
        'https://api.stability.ai/v2beta/stable-image/generate/sd3',
        {
            method:  'POST',
            headers: { Authorization: `Bearer ${STABILITY_KEY}`, Accept: 'application/json' },
            body:    form,
        }
    );

    if (!stabilityResp.ok) {
        const err = await stabilityResp.text();
        throw new Error(`Stability AI ${stabilityResp.status}: ${err}`);
    }

    const data = await stabilityResp.json();
    if (!data.image) throw new Error(`No image in response: ${JSON.stringify(data).slice(0, 200)}`);

    const maleBuffer = Buffer.from(data.image, 'base64');

    // ── Step 3: Save to public/ folder ────────────────────────────────────
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, maleBuffer);

    console.log(`\n✅  Saved to: ${OUT_PATH}`);
    console.log('\nNext steps:');
    console.log('  1. Run: vercel deploy --prod');
    console.log('  2. The male avatar will be live at:');
    console.log('     https://avatar-app-gilt.vercel.app/avatar_fullbody_male.jpg');
    console.log('  3. Claude will update the iOS fallback URL automatically after deploy.\n');
}

main().catch(err => { console.error('❌ ', err.message); process.exit(1); });
