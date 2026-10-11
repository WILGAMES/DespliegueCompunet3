import { Test, TestingModule } from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;

  const authServiceMock = {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule =
      await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          {
            provide: AuthService,
            useValue: authServiceMock,
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: jest.fn(() => true),
        })
        .compile();

    controller =
      module.get<AuthController>(
        AuthController,
      );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});