import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

import { AiService } from './ai.service';

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(),
}));

describe('AiService', () => {
  const GoogleGenAIMock =
    GoogleGenAI as unknown as jest.Mock;

  let generateContentMock: jest.Mock;
  let getModelMock: jest.Mock;

  const envKeys = [
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'GEMINI_TIMEOUT_MS',
  ];

  const originalEnv: Record<
    string,
    string | undefined
  > = {};

  /**
   * Crea el servicio con las variables de entorno indicadas.
   * Sin ConfigModule, ConfigService lee directamente process.env.
   */
  const createService = (
    env: Record<string, string | undefined> = {},
  ) => {
    for (const key of envKeys) {
      delete process.env[key];
    }

    const values = {
      GEMINI_API_KEY: 'test-api-key',
      ...env,
    };

    for (const [key, value] of Object.entries(
      values,
    )) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }

    return new AiService(new ConfigService());
  };

  const geminiResponse = (
    payload: Record<string, unknown>,
  ) => ({
    text: JSON.stringify(payload),
  });

  const fallbackResult = {
    decision: 'REVIEW',
    risk: 'MEDIUM',
    reason:
      'No fue posible completar la validación automática. Requiere revisión administrativa.',
    confidence: 0,
  };

  const validate = (service: AiService) =>
    service.validateListing(
      'Laptop Lenovo',
      'Laptop Lenovo en buen estado para trabajo.',
      'Tecnología',
    );

  beforeEach(() => {
    jest.clearAllMocks();

    for (const key of envKeys) {
      originalEnv[key] = process.env[key];
    }

    generateContentMock = jest.fn();
    getModelMock = jest.fn().mockResolvedValue({});

    GoogleGenAIMock.mockImplementation(() => ({
      models: {
        generateContent: generateContentMock,
        get: getModelMock,
      },
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();

    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('should be defined', () => {
    expect(createService()).toBeDefined();
  });

  describe('configuración', () => {
    it('should return REVIEW when API key is missing', async () => {
      const service = createService({
        GEMINI_API_KEY: undefined,
      });

      const result = await validate(service);

      expect(result).toEqual({
        decision: 'REVIEW',
        risk: 'MEDIUM',
        reason:
          'La validación automática con IA no está disponible. Requiere revisión administrativa.',
        confidence: 0,
      });

      expect(
        generateContentMock,
      ).not.toHaveBeenCalled();
    });

    it('should use gemini-3.8-flash by default', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'LOW',
          reasons: [],
          confidence: 0.95,
        }),
      );

      await validate(createService());

      expect(
        generateContentMock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-3.8-flash',
        }),
      );
    });

    it('should use the model configured in GEMINI_MODEL', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'LOW',
          reasons: [],
          confidence: 0.95,
        }),
      );

      await validate(
        createService({
          GEMINI_MODEL: 'gemini-otro-modelo',
        }),
      );

      expect(
        generateContentMock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-otro-modelo',
        }),
      );
    });
  });

  describe('timeout', () => {
    it('should send an abort signal using GEMINI_TIMEOUT_MS', async () => {
      const timeoutSpy = jest.spyOn(
        AbortSignal,
        'timeout',
      );

      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'LOW',
          reasons: [],
          confidence: 0.95,
        }),
      );

      await validate(
        createService({
          GEMINI_TIMEOUT_MS: '3000',
        }),
      );

      expect(timeoutSpy).toHaveBeenCalledWith(
        3000,
      );

      const call =
        generateContentMock.mock.calls[0][0];

      expect(
        call.config.abortSignal,
      ).toBeInstanceOf(AbortSignal);
    });

    it('should use a 10 second timeout when GEMINI_TIMEOUT_MS is invalid', async () => {
      const timeoutSpy = jest.spyOn(
        AbortSignal,
        'timeout',
      );

      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'LOW',
          reasons: [],
          confidence: 0.95,
        }),
      );

      await validate(
        createService({
          GEMINI_TIMEOUT_MS: 'abc',
        }),
      );

      expect(timeoutSpy).toHaveBeenCalledWith(
        10000,
      );
    });

    it('should return REVIEW when the request times out', async () => {
      const timeoutError = new Error(
        'The operation was aborted due to timeout',
      );
      timeoutError.name = 'TimeoutError';

      generateContentMock.mockRejectedValue(
        timeoutError,
      );

      const result = await validate(
        createService(),
      );

      expect(result).toEqual(fallbackResult);
    });
  });

  describe('decisiones', () => {
    it('should return APPROVE with a default reason when Gemini gives no reasons', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'LOW',
          reasons: [],
          confidence: 0.91,
        }),
      );

      const result = await validate(
        createService(),
      );

      expect(result).toEqual({
        decision: 'APPROVE',
        risk: 'LOW',
        reason:
          'No se identificaron riesgos relevantes.',
        confidence: 0.91,
      });

      expect(
        generateContentMock,
      ).toHaveBeenCalledTimes(1);
    });

    it('should join and trim the reasons returned by Gemini', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'LOW',
          reasons: [
            '  Producto legítimo.  ',
            '',
            'Descripción clara.',
          ],
          confidence: 0.95,
        }),
      );

      const result = await validate(
        createService(),
      );

      expect(result.reason).toBe(
        'Producto legítimo.; Descripción clara.',
      );
    });

    it('should return REJECT for a confident rejection', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'REJECT',
          risk: 'HIGH',
          reasons: [
            'El producto está prohibido.',
          ],
          confidence: 0.99,
        }),
      );

      const result = await validate(
        createService(),
      );

      expect(result).toEqual({
        decision: 'REJECT',
        risk: 'HIGH',
        reason: 'El producto está prohibido.',
        confidence: 0.99,
      });
    });

    it('should keep a REVIEW recommendation even with low confidence', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'REVIEW',
          risk: 'MEDIUM',
          reasons: [
            'La información no es suficiente.',
          ],
          confidence: 0.45,
        }),
      );

      const result = await validate(
        createService(),
      );

      expect(result).toEqual({
        decision: 'REVIEW',
        risk: 'MEDIUM',
        reason:
          'La información no es suficiente.',
        confidence: 0.45,
      });
    });

    it('should send an APPROVE with MEDIUM risk to REVIEW', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'MEDIUM',
          reasons: ['Descripción algo vaga.'],
          confidence: 0.95,
        }),
      );

      const result = await validate(
        createService(),
      );

      expect(result.decision).toBe('REVIEW');
      expect(result.risk).toBe('MEDIUM');
      expect(result.reason).toContain(
        'Descripción algo vaga.',
      );
    });

    it('should send an APPROVE with low confidence to REVIEW', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'LOW',
          reasons: [],
          confidence: 0.5,
        }),
      );

      const result = await validate(
        createService(),
      );

      expect(result.decision).toBe('REVIEW');
      expect(result.confidence).toBe(0.5);
    });

    it('should send a REJECT with low confidence to REVIEW', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'REJECT',
          risk: 'HIGH',
          reasons: ['Posible producto prohibido.'],
          confidence: 0.6,
        }),
      );

      const result = await validate(
        createService(),
      );

      expect(result.decision).toBe('REVIEW');
      expect(result.risk).toBe('HIGH');
    });

    it('should approve when confidence is exactly the minimum', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'LOW',
          reasons: [],
          confidence: 0.7,
        }),
      );

      const result = await validate(
        createService(),
      );

      expect(result.decision).toBe('APPROVE');
    });
  });

  describe('respuestas inválidas o con error', () => {
    it('should return REVIEW when Gemini returns an invalid decision', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'INVALID',
          risk: 'LOW',
          reasons: ['Respuesta inválida.'],
          confidence: 0.9,
        }),
      );

      expect(
        await validate(createService()),
      ).toEqual(fallbackResult);
    });

    it('should return REVIEW when Gemini returns an invalid risk', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'EXTREME',
          reasons: [],
          confidence: 0.9,
        }),
      );

      expect(
        await validate(createService()),
      ).toEqual(fallbackResult);
    });

    it('should return REVIEW when reasons is not an array of strings', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'LOW',
          reasons: 'Producto válido',
          confidence: 0.9,
        }),
      );

      expect(
        await validate(createService()),
      ).toEqual(fallbackResult);
    });

    it('should return REVIEW when a REJECT has no reasons', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'REJECT',
          risk: 'HIGH',
          reasons: ['   '],
          confidence: 0.95,
        }),
      );

      expect(
        await validate(createService()),
      ).toEqual(fallbackResult);
    });

    it('should return REVIEW when Gemini returns an invalid confidence', async () => {
      generateContentMock.mockResolvedValue(
        geminiResponse({
          decision: 'APPROVE',
          risk: 'LOW',
          reasons: [],
          confidence: 1.5,
        }),
      );

      expect(
        await validate(createService()),
      ).toEqual(fallbackResult);
    });

    it('should return REVIEW when Gemini returns invalid JSON', async () => {
      generateContentMock.mockResolvedValue({
        text: '{invalid-json',
      });

      expect(
        await validate(createService()),
      ).toEqual(fallbackResult);
    });

    it('should return REVIEW when Gemini returns an empty response', async () => {
      generateContentMock.mockResolvedValue({
        text: '',
      });

      expect(
        await validate(createService()),
      ).toEqual(fallbackResult);
    });

    it('should return REVIEW when Gemini throws an error (cuota, red, etc.)', async () => {
      generateContentMock.mockRejectedValue(
        new Error('Gemini unavailable'),
      );

      expect(
        await validate(createService()),
      ).toEqual(fallbackResult);
    });
  });

  describe('verificación del modelo al arrancar', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('consulta el modelo configurado y lo da por válido', async () => {
      const service = createService({ GEMINI_MODEL: 'gemini-3.8-flash' });
      const log = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation();

      service.onModuleInit();
      await flush();

      expect(getModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-3.8-flash' }),
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('gemini-3.8-flash'),
      );
    });

    it('avisa en el log (sin lanzar) si el modelo no existe o la clave falla', async () => {
      getModelMock.mockRejectedValue(new Error('404 model not found'));

      const service = createService({ GEMINI_MODEL: 'modelo-inexistente' });
      const error = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation();

      expect(() => service.onModuleInit()).not.toThrow();
      await flush();

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('modelo-inexistente'),
        '404 model not found',
      );
    });

    it('sin clave de API no consulta nada', async () => {
      const service = createService({ GEMINI_API_KEY: undefined });

      service.onModuleInit();
      await flush();

      expect(getModelMock).not.toHaveBeenCalled();
    });
  });
});
