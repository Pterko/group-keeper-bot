

export function toError(error: any): Error {
  if (error instanceof Error) {
      return error;
  } else if (typeof error === "string") {
      return new Error(error);
  } else if (typeof error === "object") {
      const errorString = JSON.stringify(error, Object.getOwnPropertyNames(error));
      return new Error(errorString);
  }
  return new Error("Unknown error");
}