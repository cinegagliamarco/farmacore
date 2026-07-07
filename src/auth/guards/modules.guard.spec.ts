import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModulesGuard } from './modules.guard';
import { RequireModule } from '../decorators/require-module.decorator';
import { ModuleCode } from '../../database/enums/module-code.enum';

describe('ModulesGuard', () => {
  const tenants = { findBySlug: jest.fn() };
  const guard = new ModulesGuard(new Reflector(), tenants as never);

  function ctx(handler: () => void, user?: unknown): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  const open = () => {};
  class Gated {
    @RequireModule(ModuleCode.PRICING_RULES, ModuleCode.OFFER_BOOK_RULES)
    public handler(): void {}
  }
  const gated = Gated.prototype.handler;
  const user = { sub: 'u1', tenantId: 'acme', role: 'admin' };

  beforeEach(() => tenants.findBySlug.mockReset());

  it('passes routes without @RequireModule', async () => {
    await expect(guard.canActivate(ctx(open, user))).resolves.toBe(true);
    expect(tenants.findBySlug).not.toHaveBeenCalled();
  });

  it('bypasses system admins without tenant lookup', async () => {
    const sys = { ...user, tenantId: 'system' };
    await expect(guard.canActivate(ctx(gated, sys))).resolves.toBe(true);
    expect(tenants.findBySlug).not.toHaveBeenCalled();
  });

  it('passes when the tenant has one of the required modules', async () => {
    tenants.findBySlug.mockResolvedValue({
      modules: [ModuleCode.OFFER_BOOK_RULES],
    });
    await expect(guard.canActivate(ctx(gated, user))).resolves.toBe(true);
    expect(tenants.findBySlug).toHaveBeenCalledWith('acme');
  });

  it('rejects when the tenant has none of the required modules', async () => {
    tenants.findBySlug.mockResolvedValue({
      modules: [ModuleCode.CROSSED_PRODUCTS],
    });
    await expect(guard.canActivate(ctx(gated, user))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects gated routes without user', async () => {
    await expect(guard.canActivate(ctx(gated))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('maps offboarded tenant (404 do findBySlug) to 403', async () => {
    tenants.findBySlug.mockRejectedValue(new NotFoundException());
    await expect(guard.canActivate(ctx(gated, user))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
