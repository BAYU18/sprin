/**
 * Wrapper for the `ipp` npm package — provides TypeScript types and a single import path
 */
import * as ippPkg from 'ipp';

export const ipp: any = (ippPkg as any).default || ippPkg;
