import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import * as https from 'node:https';

export interface A7PharmaCredentials {
  baseUrl: string;
  apiKey: string;
}

const TIMEOUT_MS = 30_000;
// The A7Pharma webapi commonly serves a self-signed cert (port legacy).
const AGENT = new https.Agent({ rejectUnauthorized: false });

/**
 * A7Pharma REST write client (port of legacy a7-pharma-api.service.ts).
 * Prices/offers are written over HTTP — distinct from the read-only DB
 * connection. Per-tenant creds are resolved by IntegrationConnectionService.
 */
@Injectable()
export class A7PharmaApiClient {
  private readonly logger = new Logger(A7PharmaApiClient.name);

  constructor(private readonly http: HttpService) {}

  /** POST /webapi/api/preco/ — set a product's sell price by idEmbalagem. */
  public async changePrices(
    creds: A7PharmaCredentials,
    items: Array<{ idEmbalagem: number; precoVendaNovo: number }>,
  ): Promise<void> {
    const url = `${creds.baseUrl}/webapi/api/preco/?alterarIrmas=false`;
    await this.post(url, items, creds.apiKey, 'changePrices');
  }

  /** POST /webapi/api/oferta/?idCadernoOferta=… — set an offer price
   *  (precoOferta=null removes it). */
  public async upsertOffer(
    creds: A7PharmaCredentials,
    idCadernoOferta: number,
    items: Array<{ idEmbalagem: number; precoOferta: number | null }>,
  ): Promise<void> {
    const url = `${creds.baseUrl}/webapi/api/oferta/?idCadernoOferta=${idCadernoOferta}`;
    await this.post(url, items, creds.apiKey, 'upsertOffer');
  }

  private async post(
    url: string,
    payload: unknown,
    apiKey: string,
    op: string,
  ): Promise<void> {
    this.logger.log(`A7Pharma ${op} -> ${url}`);
    await this.http.axiosRef.post(url, payload, {
      headers: { 'Content-Type': 'application/json', 'API-KEY': apiKey },
      timeout: TIMEOUT_MS,
      httpsAgent: AGENT,
    });
  }
}
