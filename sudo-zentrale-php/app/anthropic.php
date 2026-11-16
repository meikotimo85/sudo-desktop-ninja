<?php
// anthropic.php – Frag Sudo: Anfrage an die Claude-API und Weiterreichen des Datenstroms (SSE) an den Sudo.
// Gleicher Inhalt wie ask-core.js im Desktop-Client – bitte beide gleich halten.
declare(strict_types=1);

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const CLAUDE_VERSION = '2023-06-01';
// Preise in US-Dollar pro 1 Mio. Token (Stand November 2026)
const CLAUDE_MODELS = [
    'haiku' => ['id' => 'claude-haiku-5-5', 'in' => 0.10, 'out' => 0.50],
    'sonnet' => ['id' => 'claude-sonnet-5-5', 'in' => 2.0, 'out' => 10.0],
];

function claude_system(string $lang, string $context, string $kb = ''): string
{
    $names = ['de' => 'Deutsch', 'en' => 'English', 'ja' => '日本語 (Japanese)'];
    $lines = [
        'Du bist Sudo, ein kleiner Pixel-Ninja mit Hoodie, Headset und USB-Katana, der als Desktop-Begleiter auf dem Windows-Desktop eines IT-Profis lebt.',
        'Dein Mensch arbeitet mit Microsoft 365, Entra ID, Intune, Exchange Online, Netzwerken, PowerShell, PHP und Web-Entwicklung.',
        'Antworte hilfreich, korrekt und knapp: normalerweise höchstens 4 kurze Sätze, außer es wird ausdrücklich mehr verlangt.',
        'Code und Befehle immer in Markdown-Codeblöcken mit Sprachangabe. Keine Überschriften, kaum Aufzählungen.',
        'Ton: freundlich, trocken, ein Hauch IT-Humor – aber Hilfe geht vor Witz. Wenn du dir nicht sicher bist, sag das offen.',
        'Frag nie nach Passwörtern, Schlüsseln oder Kundendaten. Bei riskanten Befehlen (Löschen, Neustart, Massenänderungen) kurz warnen.',
        'Antworte auf ' . ($names[$lang] ?? $names['de']) . '.',
    ];
    if ($context !== '') $lines[] = "Aktuelle Lage auf dem PC (nur als Hintergrund, nicht ungefragt erwähnen):\n" . $context;
    if ($kb !== '') $lines[] = "Interne Anleitungen der Firma aus SharePoint (Auszüge). Wenn eine davon zur Frage passt, stütze dich darauf und nenne den Link als Markdown-Link. Erfinde keine Inhalte, die dort nicht stehen:\n" . $kb;
    return implode("\n", $lines);
}

function claude_cost(string $model, int $in, int $out): float
{
    $m = CLAUDE_MODELS[$model] ?? CLAUDE_MODELS['haiku'];
    return ($in * $m['in'] + $out * $m['out']) / 1e6;
}

/**
 * Fragt Claude mit Streaming und gibt jeden SSE-Block sofort an den Browser/Sudo weiter.
 * @return array{status:int, in:int, out:int, error:?string, body:string}
 */
function claude_stream(string $url, string $key, array $body): array
{
    $status = 0; $buf = ''; $errBody = ''; $in = 0; $out = 0; $started = false;
    $send = function (string $block) use (&$in, &$out) {
        echo $block, "\n\n";
        if (ob_get_level()) @ob_flush();
        flush();
        foreach (explode("\n", $block) as $line) {
            if (strncmp($line, 'data:', 5) !== 0) continue;
            $ev = json_decode(trim(substr($line, 5)), true);
            if (!is_array($ev)) continue;
            if (($ev['type'] ?? '') === 'message_start') {
                $u = $ev['message']['usage'] ?? [];
                $in = (int) ($u['input_tokens'] ?? 0) + (int) ($u['cache_creation_input_tokens'] ?? 0) + (int) ($u['cache_read_input_tokens'] ?? 0);
                $out = (int) ($u['output_tokens'] ?? 0);
            } elseif (($ev['type'] ?? '') === 'message_delta' && isset($ev['usage']['output_tokens'])) {
                $out = (int) $ev['usage']['output_tokens'];
            }
        }
    };
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => ['content-type: application/json', 'x-api-key: ' . $key, 'anthropic-version: ' . CLAUDE_VERSION],
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_HEADERFUNCTION => function ($ch, $h) use (&$status) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $status = (int) $m[1];
            return strlen($h);
        },
        CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$status, &$buf, &$errBody, &$started, $send) {
            if ($status !== 200) { $errBody .= $chunk; return strlen($chunk); }
            if (!$started) {
                $started = true;
                // Ab jetzt: Datenstrom an den Sudo, ohne Puffer
                @ini_set('zlib.output_compression', '0');
                while (ob_get_level() > 0) @ob_end_flush();
                header('Content-Type: text/event-stream; charset=utf-8');
                header('Cache-Control: no-cache');
                header('X-Accel-Buffering: no');
            }
            $buf .= str_replace("\r\n", "\n", $chunk);
            while (($i = strpos($buf, "\n\n")) !== false) { $send(substr($buf, 0, $i)); $buf = substr($buf, $i + 2); }
            return connection_aborted() ? 0 : strlen($chunk);
        },
    ]);
    $ok = curl_exec($ch);
    $err = $ok === false ? curl_error($ch) : null;
    curl_close($ch);
    if ($started && trim($buf) !== '') $send($buf);
    return ['status' => $status, 'in' => $in, 'out' => $out, 'error' => $err, 'body' => $errBody, 'started' => $started];
}
