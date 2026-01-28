import { z } from 'zod';
import { hasValidToken, startAuthFlow, isAuthInProgress, getAuthUrl } from '../auth.js';

export type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export function createSuccessResponse(data: any): ToolResponse {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data),
      },
    ],
  };
}

export function createErrorResponse(error: any): ToolResponse {
  const errorMessage = error?.message || String(error);
  return {
    content: [
      {
        type: 'text' as const,
        text: `Error: ${errorMessage}`,
      },
    ],
  };
}

export function createAuthRequiredResponse(url: string): ToolResponse {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Authentication required. Please sign in at:\n\n${url}\n\nAfter signing in, try your request again.`,
      },
    ],
    isError: true,
  };
}

export function createToolHandler<T>(
  handler: (params: T) => Promise<any>
): (params: T) => Promise<ToolResponse> {
  return async (params: T) => {
    // Check auth first
    if (!hasValidToken()) {
      // Start auth if not already in progress
      if (!isAuthInProgress()) {
        try {
          await startAuthFlow();
        } catch (error) {
          // Ignore - we'll show the auth URL below
        }
      }
      const url = getAuthUrl();
      if (url) {
        return createAuthRequiredResponse(url);
      }
      return createErrorResponse('Authentication required. Please use vapi_login tool first.');
    }

    try {
      const result = await handler(params);
      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createParamsSchema<T>(schema: z.ZodType<T>): any {
  return {
    properties: {
      params: (schema as any).shape || {},
    },
    required: ['params'],
  };
}

export function createIdParamSchema(
  paramName: string,
  description: string
): any {
  return {
    properties: {
      [paramName]: { type: 'string', description },
    },
    required: [paramName],
  };
}

export const withErrorHandling = <T>(
  handler: () => Promise<T>
): Promise<ToolResponse> => {
  return handler()
    .then((result) => createSuccessResponse(result))
    .catch((error) => createErrorResponse(error));
};

export const filterResponseWithSchema = <T>(
  data: any,
  schema: z.ZodType<T>
): T => {
  if (Array.isArray(data)) {
    return data.map((item) => schema.parse(item)) as unknown as T;
  }
  return schema.parse(data);
};

export const withSchemaFiltering = <T>(
  handler: () => Promise<any>,
  schema: z.ZodType<T>
): Promise<ToolResponse> => {
  return handler()
    .then((result) => {
      const filtered = filterResponseWithSchema(result, schema);
      return createSuccessResponse(filtered);
    })
    .catch((error) => createErrorResponse(error));
};
