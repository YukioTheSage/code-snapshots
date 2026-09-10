import { SemanticSearchWebview } from '../semanticSearchWebview';

describe('SemanticSearchWebview CSP', () => {
  it('injects CSP and a shared nonce for script/style', () => {
    const webview = new SemanticSearchWebview({} as any, {} as any);
    const html = (webview as any).getWebviewContent({
      cspSource: 'vscode-webview-resource:',
    });

    expect(html).toContain('Content-Security-Policy');
    const nonceMatch = html.match(/script-src 'nonce-([^']+)'/);
    expect(nonceMatch).toBeTruthy();

    const nonce = nonceMatch![1];
    expect(html).toContain(`<style nonce="${nonce}">`);
    expect(html).toContain(`<script nonce="${nonce}">`);
  });
});
