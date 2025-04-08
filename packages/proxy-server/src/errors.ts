export class ProxyError extends Error {
    /**
     * @param message - Human-readable error message
     * @param statusCode - HTTP status code to return
     */
    constructor(
        message: string,
        public readonly statusCode: number = 500
    ) {
        super(message);
        this.name = this.constructor.name;

        // Ensures proper prototype chain for instanceof checks
        Object.setPrototypeOf(this, ProxyError.prototype);
    }
}

export class NotFoundError extends ProxyError {
    constructor(message: string) {
        super(message, 404);
    }
}

export class ValidationError extends ProxyError {
    constructor(message: string) {
        super(message, 400);
    }
}

export class ServerError extends ProxyError {
    constructor(message: string) {
        super(message, 500);
    }
}

/**
 * Handles an error and sends an appropriate response
 */
export function handleError(error: unknown): ProxyError {
    // If it's our custom error type, use its status code
    if (error instanceof ProxyError) return error;

    // For standard errors, use the message but return 500
    if (error instanceof Error) return new ServerError(error.message);

    // For completely unknown errors
    return new ServerError('An unknown error occurred');
}
