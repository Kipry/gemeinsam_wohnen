/**
 * Rechnet einen eingetippten Ausdruck wie "12,50+8,30+4" oder "3×2,50" in Cent um.
 *
 * Bewusst kein eval: die Eingabe wird in Zahlen und Operatoren zerlegt und
 * selbst ausgewertet. Punkt vor Strich gilt.
 *
 * Ein offener Operator am Ende ("12,50+") wird ignoriert, damit während des
 * Tippens durchgehend ein Zwischenergebnis angezeigt werden kann.
 */
export function evaluateAmountExpression(input: string): number | null {
  const normalized = input
    .replace(/\s/g, "")
    .replace(/[×x]/g, "*")
    .replace(/[÷:]/g, "/")
    .replace(/,/g, ".");

  if (!normalized) return null;

  const tokens = tokenize(normalized);
  if (!tokens) return null;

  while (tokens.length > 0 && typeof tokens[tokens.length - 1] === "string") {
    tokens.pop();
  }
  if (tokens.length === 0) return null;

  for (let i = 0; i < tokens.length; i++) {
    const expectsNumber = i % 2 === 0;
    if (expectsNumber !== (typeof tokens[i] === "number")) return null;
  }

  const afterMulDiv: (number | string)[] = [tokens[0]];
  for (let i = 1; i < tokens.length; i += 2) {
    const operator = tokens[i] as string;
    const right = tokens[i + 1] as number;

    if (operator === "*" || operator === "/") {
      const left = afterMulDiv.pop() as number;
      if (operator === "/" && right === 0) return null;
      afterMulDiv.push(operator === "*" ? left * right : left / right);
    } else {
      afterMulDiv.push(operator, right);
    }
  }

  let result = afterMulDiv[0] as number;
  for (let i = 1; i < afterMulDiv.length; i += 2) {
    const operator = afterMulDiv[i] as string;
    const right = afterMulDiv[i + 1] as number;
    result = operator === "+" ? result + right : result - right;
  }

  if (!Number.isFinite(result) || result < 0) return null;
  return Math.round(result * 100);
}

/** Enthält der Ausdruck eine Rechnung (statt nur einer Zahl)? */
export function isCalculation(input: string): boolean {
  return /[+\-*/×÷x:]/.test(input.replace(/\s/g, ""));
}

const OPERATORS = ["+", "−", "×", "÷"];

/** Fügt eine Keypad-Taste an den Ausdruck an und hält ihn dabei gültig. */
export function applyKey(expression: string, key: string): string {
  if (key === "⌫") return expression.slice(0, -1);

  const last = expression.slice(-1);
  const currentNumber = expression.split(/[+\-−*×/÷]/).pop() ?? "";

  if (OPERATORS.includes(key)) {
    if (expression === "") return "";
    if (OPERATORS.includes(last)) return expression.slice(0, -1) + key;
    return expression + key;
  }

  if (key === ",") {
    if (currentNumber.includes(",")) return expression;
    if (currentNumber === "") return expression + "0,";
    return expression + ",";
  }

  // keine führenden Nullen wie "007"
  if (currentNumber === "0") return expression.slice(0, -1) + key;

  return expression + key;
}

function tokenize(source: string): (number | string)[] | null {
  const tokens: (number | string)[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if ("+-*/".includes(char)) {
      tokens.push(char);
      index += 1;
      continue;
    }

    const match = /^\d*\.?\d+|^\d+\./.exec(source.slice(index));
    if (!match) return null;

    const value = Number(match[0].endsWith(".") ? match[0].slice(0, -1) : match[0]);
    if (!Number.isFinite(value)) return null;

    tokens.push(value);
    index += match[0].length;
  }

  return tokens;
}
