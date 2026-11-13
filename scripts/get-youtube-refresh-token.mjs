import http from 'node:http';
import crypto from 'node:crypto';
import { google } from 'googleapis';

const clientId = process.env.YT_CLIENT_ID;
const clientSecret = process.env.YT_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set YT_CLIENT_ID and YT_CLIENT_SECRET to the OAuth client from Google Cloud.');
  process.exit(1);
}

const redirectUri = process.env.YT_REDIRECT_URI || 'http://127.0.0.1:8080';
const redirect = new URL(redirectUri);
if (!['127.0.0.1', 'localhost'].includes(redirect.hostname)) {
  console.error('YT_REDIRECT_URI must use 127.0.0.1 or localhost for this local helper.');
  process.exit(1);
}

const scope = ['https://www.googleapis.com/auth/youtube.force-ssl'];
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const state = crypto.randomBytes(24).toString('hex');
const { codeVerifier, codeChallenge } = await oauth2Client.generateCodeVerifierAsync();
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope,
  state,
  code_challenge_method: 'S256',
  code_challenge: codeChallenge
});

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, redirectUri);
  if (url.pathname !== redirect.pathname) {
    response.writeHead(404);
    response.end('Not found.');
    return;
  }

  if (url.searchParams.get('state') !== state) {
    response.writeHead(400);
    response.end('Invalid OAuth state. Start the helper again.');
    return;
  }

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    response.writeHead(400);
    response.end(`Authorization failed: ${oauthError}`);
    console.error(`Authorization failed: ${oauthError}`);
    server.closeAllConnections?.();
    server.close();
    process.exitCode = 1;
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    response.writeHead(400);
    response.end('Missing authorization code.');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken({ code, codeVerifier });
    if (!tokens.refresh_token) {
      throw new Error(
        'Google did not return a refresh token. Revoke this app at https://myaccount.google.com/permissions and run the helper again.'
      );
    }

    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Authorization complete. You can close this tab and return to the terminal.');
    console.log('\nAdd this value as the GitHub Actions secret YT_REFRESH_TOKEN:\n');
    console.log(tokens.refresh_token);
    console.log('\nDo not commit it or paste it into a workflow log.');
  } catch (error) {
    response.writeHead(500);
    response.end(`Token exchange failed: ${error.message}`);
    console.error(`Token exchange failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

const timer = setTimeout(() => {
  console.error('Timed out after 5 minutes waiting for Google authorization.');
  server.closeAllConnections?.();
  server.close();
  process.exitCode = 1;
}, 5 * 60 * 1000);

server.on('close', () => clearTimeout(timer));
server.listen(Number(redirect.port || 80), redirect.hostname, () => {
  console.log('Open this URL in a browser signed in as the account that owns the YouTube channel:\n');
  console.log(authUrl);
  console.log(`\nWaiting for the OAuth callback on ${redirectUri} ...`);
});
