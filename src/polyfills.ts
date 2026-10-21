/**
 * PDF.js 4.x usa Promise.withResolvers y Promise.try. Safari antiguo no las
 * incorpora, así que las añadimos antes de cargar el módulo de PDF.
 */
type PromiseConstructorWithHelpers = PromiseConstructor & {
  withResolvers?: <T>() => {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
  try?: <T>(callback: () => T | PromiseLike<T>) => Promise<T>;
};

const promiseWithHelpers = Promise as PromiseConstructorWithHelpers;

if (typeof promiseWithHelpers.withResolvers !== 'function') {
  promiseWithHelpers.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

if (typeof promiseWithHelpers.try !== 'function') {
  promiseWithHelpers.try = function promiseTry<T>(
    callback: () => T | PromiseLike<T>,
  ) {
    return new Promise<T>((resolve, reject) => {
      try {
        resolve(callback());
      } catch (error) {
        reject(error);
      }
    });
  };
}

export {};
