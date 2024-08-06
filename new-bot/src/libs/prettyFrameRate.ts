const DEFAULT_OPTIONS = {
  decimals: 2,
  suffix: 'fps'
};

interface PrettyFrameRateOptions {
  decimals?: number;
  suffix?: string;
}

/**
 * Transform a frame-rate value into a human-readable string
 * 29.97002997 ->  "29.97fps"
 * "30000/1001" -> "29.97fps"
 * @param {number|string} input frame-rate value
 * @param {PrettyFrameRateOptions} opts decimals = 2, suffix = 'fps'
 * @returns {string|null} result
 */
const prettyFrameRate = (input: number | string, opts: PrettyFrameRateOptions = {}): string | null => {
  const options = { ...DEFAULT_OPTIONS, ...opts };

  let frameRate: number;
  if (typeof input === 'string') {
    if (input.indexOf('/') !== -1) {
      const [numerator, denominator] = input.split('/').map(Number);
      frameRate = numerator / denominator;
    } else {
      frameRate = parseInt(input, 10);
    }
  } else {
    frameRate = input;
  }

  if (typeof frameRate !== 'number' || isNaN(frameRate) || !isFinite(frameRate)) {
    return null;
  }

  const pow = 10 ** options.decimals;
  return `${Math.round(frameRate * pow) / pow}${options.suffix}`;
};

export default prettyFrameRate;