import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  A7PharmaApiResponse,
  ChangePriceItemBodyDto,
  ChangePricesBodyDto,
  CreateOrUpdateOfferBodyDto,
  CreateOrUpdateOfferItemBodyDto,
  RemoveOffersBodyDto
} from '../dto/a7-pharma-api-body.dto';

interface A7PharmaApiConfig {
  baseUrl: string;
  apiKey: string;
}

@Injectable()
export class A7PharmaApiService {
  private readonly logger = new Logger(A7PharmaApiService.name);
  private readonly config: A7PharmaApiConfig;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {
    this.config = {
      baseUrl: this.configService.get<string>('A7_PHARMA_API_URL') || '',
      apiKey: this.configService.get<string>('A7_PHARMA_API_KEY') || ''
    };
  }

  /**
   * Creates or updates offers in a caderno de ofertas.
   * If precoOferta is null, the item will be removed from the offer book.
   *
   * POST https://ipDoServidor:8443/webapi/api/oferta/?idCadernoOferta=idDoCadernoOferta
   *
   * @param dto - The offer data containing idCadernoOferta and items
   * @returns API response with success status
   */
  public async createOrUpdateOffers(dto: CreateOrUpdateOfferBodyDto): Promise<A7PharmaApiResponse> {
    const url = `${this.config.baseUrl}/webapi/api/oferta/?idCadernoOferta=${dto.idCadernoOferta}`;

    const payload = dto.items.map((item) => this.buildOfferPayloadItem(item));

    return this.executePostRequest(url, payload, 'createOrUpdateOffers');
  }

  /**
   * Removes offers by item IDs from itemcadernooferta table.
   *
   * DELETE https://ipDoServidor:8443/webapi/api/oferta/
   *
   * @param dto - The removal data containing itemCadernoOfertaIds
   * @returns API response with success status
   */
  public async removeOffers(dto: RemoveOffersBodyDto): Promise<A7PharmaApiResponse> {
    const url = `${this.config.baseUrl}/webapi/api/oferta/`;

    return this.executeDeleteRequest(url, dto.itemCadernoOfertaIds, 'removeOffers');
  }

  /**
   * Changes product prices (precoReferencial and/or precoVenda).
   *
   * POST https://ipDoServidor:8443/webapi/api/preco/?alterarIrmas=false
   *
   * @param dto - The price change data containing items and alterarIrmas flag
   * @returns API response with success status
   */
  public async changePrices(dto: ChangePricesBodyDto): Promise<A7PharmaApiResponse> {
    const alterarIrmas = dto.alterarIrmas ?? false;
    const url = `${this.config.baseUrl}/webapi/api/preco/?alterarIrmas=${alterarIrmas}`;

    const payload = dto.items.map((item) => this.buildPricePayloadItem(item));

    return this.executePostRequest(url, payload, 'changePrices');
  }

  /**
   * Builds the payload item for offer operations.
   * Only includes one identifier (idEmbalagem, etiqueta, or codigoBarras).
   */
  private buildOfferPayloadItem(item: CreateOrUpdateOfferItemBodyDto): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    if (item.idEmbalagem !== undefined) {
      payload.idEmbalagem = item.idEmbalagem;
    } else if (item.etiqueta !== undefined) {
      payload.etiqueta = item.etiqueta;
    } else if (item.codigoBarras !== undefined) {
      payload.codigoBarras = item.codigoBarras;
    }

    payload.precoOferta = item.precoOferta;

    return payload;
  }

  /**
   * Builds the payload item for price change operations.
   * Only includes one identifier (idEmbalagem, etiqueta, or codigoBarras).
   */
  private buildPricePayloadItem(item: ChangePriceItemBodyDto): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    if (item.idEmbalagem !== undefined) {
      payload.idEmbalagem = item.idEmbalagem;
    } else if (item.etiqueta !== undefined) {
      payload.etiqueta = item.etiqueta;
    } else if (item.codigoBarras !== undefined) {
      payload.codigoBarras = item.codigoBarras;
    }

    if (item.precoReferencialNovo !== undefined) {
      payload.precoReferencialNovo = item.precoReferencialNovo;
    }

    if (item.precoVendaNovo !== undefined) {
      payload.precoVendaNovo = item.precoVendaNovo;
    }

    if (item.idUnidadeNegocioPreco !== undefined) {
      payload.idUnidadeNegocioPreco = item.idUnidadeNegocioPreco;
    }

    return payload;
  }

  /**
   * Executes a POST request to the A7 Pharma API.
   */
  private async executePostRequest(url: string, payload: unknown, operation: string): Promise<A7PharmaApiResponse> {
    try {
      this.logger.log(`Executing ${operation} request to ${url} with payload ${JSON.stringify(payload)}`);

      const response = await this.httpService.axiosRef.post(url, payload, {
        headers: this.getHeaders(),
        timeout: 30000,
        httpsAgent: this.getHttpsAgent()
      });

      this.logger.log(`${operation} completed successfully with status ${response.status}`);

      return {
        success: response.status === 200,
        statusCode: response.status,
        data: response.data
      };
    } catch (error) {
      return this.handleError(error, operation);
    }
  }

  /**
   * Executes a DELETE request to the A7 Pharma API.
   */
  private async executeDeleteRequest(url: string, payload: unknown, operation: string): Promise<A7PharmaApiResponse> {
    try {
      this.logger.log(`Executing ${operation} request to ${url} with payload ${JSON.stringify(payload)}`);

      const response = await this.httpService.axiosRef.delete(url, {
        headers: this.getHeaders(),
        data: payload,
        timeout: 30000,
        httpsAgent: this.getHttpsAgent()
      });

      this.logger.log(`${operation} completed successfully with status ${response.status}`);

      return {
        success: response.status === 200,
        statusCode: response.status,
        data: response.data
      };
    } catch (error) {
      return this.handleError(error, operation);
    }
  }

  /**
   * Returns the headers for API requests.
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'API-KEY': this.config.apiKey
    };
  }

  /**
   * Returns an HTTPS agent that allows self-signed certificates.
   * The A7 Pharma API may use self-signed certificates.
   */
  private getHttpsAgent(): unknown {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https');
    return new https.Agent({
      rejectUnauthorized: false
    });
  }

  /**
   * Handles errors from API requests.
   */
  private handleError(error: unknown, operation: string): A7PharmaApiResponse {
    const axiosError = error as { response?: { status?: number; data?: unknown }; message?: string };

    this.logger.error(`Error in ${operation}: ${axiosError.message || 'Unknown error'}`, axiosError.response?.data);

    return {
      success: false,
      statusCode: axiosError.response?.status,
      error: axiosError.message || 'Unknown error',
      data: axiosError.response?.data
    };
  }
}
