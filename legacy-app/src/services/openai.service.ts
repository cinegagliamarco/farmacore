import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';

@Injectable()
export class OpenAIService {
  private openai: OpenAI;
  constructor(private readonly configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get('OPEN_AI_API_KEY')
    });
  }

  public async generateJsonPrompt(prompt: string): Promise<string> {
    const systemRole: ChatCompletionMessageParam = {
      role: 'system',
      content: 'Você é um sistema de farmácia que analisa produtos'
    };

    const response = await this.openai.chat.completions.create({
      temperature: 0,
      max_tokens: 1024,
      n: 1,
      model: 'gpt-3.5-turbo',
      messages: [systemRole, { role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    return response.choices[0].message.content;
  }

  public async generateMergedProductDescription(descriptions: string[]): Promise<string> {
    const systemRole: ChatCompletionMessageParam = {
      role: 'system',
      content: `
      Você é um especialista em produtos farmacêuticos. Sua função é analisar duas descrições de produtos (que podem vir em formato HTML) de diferentes fontes e criar uma descrição única, precisa e completa.
      Regras importantes:
      1. Extraia e combine as melhores informações de ambas as fontes
      2. Remova todas as tags HTML e formate em texto limpo
      3. Mantenha a precisão técnica e regulatória exigida para produtos farmacêuticos
      4. Priorize informações sobre: indicações, contraindicações, composição, posologia
      5. Se houver conflitos entre as fontes, escolha a informação mais completa e precisa
      6. Mantenha um tom profissional e técnico adequado para o setor farmacêutico
      7. Retorne APENAS o texto da descrição final, sem formatação JSON ou outras estruturas
      8. Remova o nome das farmácias de origem das descrições
    `};

    const userPrompt = `
      Analise as duas descrições de produto abaixo e crie uma descrição única e completa:

      ${descriptions.map((description, index) => `**DESCRIÇÃO FONTE ${index + 1}:**\n${description || 'Não disponível'}`).join('\n')}

      Crie uma descrição final que:
      - Seja clara e profissional
      - Combine as melhores informações de ambas as fontes
      - Esteja livre de tags HTML
      - Contenha informações relevantes sobre o produto farmacêutico
      - Tenha no mínimo 1500 characteres e no máximo 2000
      Retorne APENAS o texto da descrição final, sem formatação JSON, links, tags HTML, ou outras estruturas.
    `;

    const response = await this.openai.chat.completions.create({
      temperature: 0.1,
      max_tokens: 1500,
      n: 1,
      model: 'gpt-3.5-turbo',
      messages: [systemRole, { role: 'user', content: userPrompt }]
    });

    return response.choices[0].message.content;
  }
}
