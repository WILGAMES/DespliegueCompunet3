import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';

type IoServerOptions = Parameters<IoAdapter['createIOServer']>[1];

/** IoAdapter con la misma política de CORS que la API HTTP. */
export class SocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[] | boolean,
  ) {
    super(app);
  }

  createIOServer(
    port: number,
    options?: IoServerOptions,
  ): ReturnType<IoAdapter['createIOServer']> {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
    } as IoServerOptions);
  }
}
