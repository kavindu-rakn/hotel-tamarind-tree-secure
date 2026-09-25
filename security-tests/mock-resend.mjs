// Fake Resend API. Captures every email the app tries to send. Nothing leaves this machine.
import http from 'node:http'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
// fileURLToPath (not .pathname) so the path is also valid on Windows
const LOG = process.env.MAIL_LOG || fileURLToPath(new URL('./mail.log.jsonl', import.meta.url))
http.createServer((req, res) => {
  let body = ''
  req.on('data', c => body += c)
  req.on('end', () => {
    let parsed; try { parsed = JSON.parse(body) } catch { parsed = { raw: body } }
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), method: req.method, url: req.url, ...parsed }) + '\n')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: 'mock-' + Date.now() }))
  })
}).listen(4010, '127.0.0.1', () => console.log('mock resend on 4010'))
