import * as vscode from 'vscode';
import { log } from '../logger';

export class CredentialsManager {
  private static readonly PINECONE_API_KEY = 'pinecone-api-key';
  private static readonly GEMINI_API_KEY = 'gemini-api-key';
  private secretStorage: vscode.SecretStorage;

  constructor(context: vscode.ExtensionContext) {
    this.secretStorage = context.secrets;
    log('CredentialsManager initialized');
  }

  async getPineconeApiKey(): Promise<string | undefined> {
    return this.secretStorage.get(CredentialsManager.PINECONE_API_KEY);
  }

  async setFPineconeApiKey(apiKey: string): Promise<void> {
    await this.secretStorage.store(CredentialsManager.PINECONE_API_KEY, apiKey);
    log('Pinecone API key stored');
  }

  async getGeminiApiKey(): Promise<string | undefined> {
    return this.secretStorage.get(CredentialsManager.GEMINI_API_KEY);
  }

  async setGeminiApiKey(apiKey: string): Promise<void> {
    await this.secretStorage.store(CredentialsManager.GEMINI_API_KEY, apiKey);
    log('Gemini API key stored');
  }

  async hasCredentials(): Promise<boolean> {
    const [pineconeKey, geminiKey] = await Promise.all([
      this.getPineconeApiKey(),
      this.getGeminiApiKey(),
    ]);
    return !!pineconeKey && !!geminiKey;
  }

  async promptForCredentials(): Promise<boolean> {
    const pineconeKey = await vscode.window.showInputBox({
      prompt: 'Enter your Pinecone API key',
      password: true,
      ignoreFocusOut: true,
    });

    if (!pineconeKey) return false;

    const geminiKey = await vscode.window.showInputBox({
      prompt: 'Enter your Gemini API key',
      password: true,
      ignoreFocusOut: true,
    });

    if (!geminiKey) return false;

    await this.setFPineconeApiKey(pineconeKey);
    await this.setGeminiApiKey(geminiKey);
    return true;
  }
}
