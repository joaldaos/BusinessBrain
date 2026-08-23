import { UseGuards, applyDecorators } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { RATE_LIMITS, type RateLimitName } from '../http/rate-limits';

/**
 * Aplica UN límite concreto a una ruta.
 *
 * ## Por qué hace falta un decorador y no basta con el guard
 *
 * El catálogo de límites está declarado con nombres, y el guard aplica **todos** los nombres a
 * toda ruta que proteja. Sin esto, poner el límite de "entrar" en `/auth/login` le pondría
 * además el de "crear cuenta" y el de "preguntar": la ruta se cortaría por el más estrecho de
 * los tres y nadie entendería por qué.
 *
 * Así que se dice cuál se quiere y aquí se descartan los demás. Escribir esa lista de
 * descartes a mano en cada ruta sería la clase de detalle que se olvida al añadir un límite
 * nuevo — y se olvidaría en silencio, apretando rutas que no tocaba.
 */
export function RateLimited(name: RateLimitName) {
  const otros = Object.fromEntries(
    Object.keys(RATE_LIMITS)
      .filter((candidato) => candidato !== name)
      .map((candidato) => [candidato, true]),
  );

  return applyDecorators(UseGuards(RateLimitGuard), SkipThrottle(otros));
}
