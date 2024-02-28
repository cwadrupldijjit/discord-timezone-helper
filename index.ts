import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fluvial, serveFile, Request, Response } from 'fluvial';
import { cors } from '@fluvial/cors';
import { csp } from '@fluvial/csp';
import { Temporal } from 'temporal-polyfill';
import { chromium } from 'playwright';
import { QueryDictionary } from 'fluvial/dist/path-matching';

const playwrightInstance = await chromium.launch({
    headless: true,
});

const browserContext = await playwrightInstance.newContext({ ignoreHTTPSErrors: true });

const __dirname = fileURLToPath(dirname(import.meta.url));

const app = fluvial({
    ssl: {
        certificatePath: join(__dirname, '.cert', 'cert.pem'),
        keyPath: join(__dirname, '.cert', 'key.pem'),
    },
});

app.use((req: Request, res: Response) => {
    console.log(`[${Temporal.Now.instant().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}]`, req.method, req.path, req.query);
    return 'next' as const;
});

app.use(cors());
app.use(csp({
    directives: {
        'default-src': [ 'https:', "'unsafe-inline'" ]
    }
}));

app.get('/embed', async (req, res) => {
    const { tz, additionalTimezones, year, month, day, hour, minute } = req.query;
    
    const indexHtml = await readFile(join(__dirname, 'embed.html'), 'utf-8');

    const mainTimezone = (tz ?? 'America/Denver') as Temporal.TimeZoneLike;

    const keyFormats = [
        {
            name: 'Ward Radio HQ',
            timezone: 'America/Los_Angeles',
            locale: 'en-US',
        },
        {
            name: 'US East Coasters',
            timezone: 'America/New_York',
            locale: 'en-US',
        },
        {
            name: 'Mormon Central Time (Utah)',
            timezone: 'America/Denver',
            locale: 'en-US',
        },
        {
            name: 'Sydney, AU',
            timezone: 'Australia/Sydney',
            locale: 'en-AU',
        },
        {
            name: 'UTC/Zulu/GMT',
            timezone: 'Etc/UTC',
            locale: 'en-GB',
        },
        ...(typeof additionalTimezones == 'string' ? additionalTimezones.split(',') : Array.isArray(additionalTimezones) ? additionalTimezones : [])
            .map((tzString) => ({ name: tzString, timezone: tzString, locale: 'en-US' })),
    ];

    const targetDate = Temporal.ZonedDateTime.from({
        timeZone: mainTimezone,
        year: +(year ?? 2024),
        month: +(month ?? 1),
        day: +(day ?? 12),
        hour: +(hour ?? 16),
        minute: +(minute ?? 0),
    });

    const formatOptions: Parameters<Temporal.Instant['toLocaleString']>[1] = {
        dateStyle: 'long',
        timeStyle: 'long',
    };
    
    const styles = [ 'normal', 'wingdings', 'aurebesh' ];
    
    res.headers['cache-control'] = 'nocache';
    res.headers['content-type'] = 'text/html';
    res.send(indexHtml
        .replace('<%content%>', styles
            .map((clss) => `
                <div class="${clss}">
                    <p>Server time: ${Temporal.Now.instant().toLocaleString('en-US', formatOptions)}</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Area</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${!keyFormats.some(f => f.timezone == mainTimezone) ? `<tr><td>${mainTimezone}</td><td>${targetDate.toLocaleString(req.query.locale ?? 'en-US', formatOptions)}</td></tr>` : ''}
                            ${keyFormats.map(f => {
                                let resultDatetime: Temporal.ZonedDateTime;
                                
                                if (f.timezone == mainTimezone) {
                                    resultDatetime = targetDate;
                                }
                                else {
                                    resultDatetime = targetDate
                                        .toInstant()
                                        .toZonedDateTimeISO(f.timezone);
                                }
                                
                                return `<tr><td>${f.name}</td><td>${resultDatetime.toLocaleString(f.locale, formatOptions)}</td></tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `)
            .join('\n')
        )
        .replace('screenshot.png', 'screenshot.png?' + new URLSearchParams(req.query)));
});
app.get('/style.css', serveFile(join(__dirname, 'style.css'), { mimeType: 'text/css' }));
app.get('/AurebeshAfCanon-K7Ope.otf', serveFile(join(__dirname, 'AurebeshAFCanon-K7Ope.otf'), { mimeType: 'font/otf' }));
app.get('/Wingdings.ttf', serveFile(join(__dirname, 'Wingdings.ttf'), { mimeType: 'font/ttf' }));
app.get('/Wingdings.woff', serveFile(join(__dirname, 'Wingdings.woff'), { mimeType: 'font/woff' }));

const screenshotCache: Record<string, string> = existsSync(join(__dirname, '.tmp', 'cache.json')) ? (await import('./.tmp/cache.json', { with: { type: 'json' }})).default : {};

app.get('/screenshot.png', async (req, res) => {
    const cacheSlug = toScreenshotCacheSlug(req.query);
    
    res.headers['content-type'] = 'image/png';
    
    if (cacheSlug in screenshotCache && existsSync(screenshotCache[cacheSlug])) {
        res.send(await readFile(screenshotCache[cacheSlug]));
        return;
    }
    else if (screenshotCache[cacheSlug]) {
        await rm(screenshotCache[cacheSlug]);
        delete screenshotCache[cacheSlug];
    }
    
    const page = await browserContext.newPage();
    
    await page.goto('https://localhost:8990/embed?' + new URLSearchParams(req.query));
    const boundingBox = await page.locator('.normal table').boundingBox();
    
    const image = await page.screenshot({
        clip: {
            x: boundingBox.x - 4,
            y: boundingBox.y - 4,
            width: boundingBox.width + 8,
            height: boundingBox.height + 8,
        },
        type: 'png',
    });
    
    await page.close();
    
    screenshotCache[cacheSlug] = join(__dirname, '.tmp', randomUUID() + '.png');
    
    await writeFile(screenshotCache[cacheSlug], image);
    await writeFile(join(__dirname, '.tmp', 'cache.json'), JSON.stringify(screenshotCache, null, 4));
    
    res.send(image);
});

app.listen(8990, () => {
    console.log('began on port 8990');
});

function toScreenshotCacheSlug(query: Readonly<QueryDictionary>) {
    return Object.entries(query)
        .sort(([ a ], [ b ]) => a.localeCompare(b))
        .map(([ key, value ]) => `${key}:${Array.isArray(value) ? value.join(',') : value}`)
        .join(';');
}
