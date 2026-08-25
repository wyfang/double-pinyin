(() => {
  const CIPHER_GLYPHS = Array.from(
    "天地玄黄宇宙洪荒甲乙丙丁戊己庚辛壬癸乾坤坎离震巽艮兑零壹贰叁肆伍陆柒捌玖密钥令禁封藏隐",
  );
  const MAX_SCRAMBLE_DURATION = 8000;
  const MAX_DESTROY_DURATION = 2000;
  const SCRAMBLE_TAIL_LENGTH = 8;

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  function randomCipherGlyph() {
    return CIPHER_GLYPHS[Math.floor(Math.random() * CIPHER_GLYPHS.length)];
  }

  function wait(duration) {
    return new Promise((resolve) => window.setTimeout(resolve, duration));
  }

  function createCharacterSpans(element, text) {
    const characters = Array.from(text);
    const spans = Array(characters.length).fill(null);
    const fragment = document.createDocumentFragment();

    characters.forEach((character, index) => {
      if (character === "\n") {
        fragment.append(document.createTextNode(character));
        return;
      }

      const span = document.createElement("span");
      span.className = "decode-char";
      span.textContent = character;
      span.setAttribute("aria-hidden", "true");

      if (/\s/.test(character)) {
        span.classList.add("is-whitespace");
      } else {
        spans[index] = span;
      }

      fragment.append(span);
    });

    element.replaceChildren(fragment);
    return { characters, spans };
  }

  function createRevealUnits(text) {
    const units = [];
    let pendingWhitespace = "";

    Array.from(text).forEach((character) => {
      if (/\s/.test(character)) {
        pendingWhitespace += character;
        return;
      }

      units.push(pendingWhitespace + character);
      pendingWhitespace = "";
    });

    if (pendingWhitespace) {
      if (units.length) {
        units[units.length - 1] += pendingWhitespace;
      } else {
        units.push(pendingWhitespace);
      }
    }

    return units;
  }

  function appendResolvedUnit(fragment, unit) {
    Array.from(unit).forEach((character) => {
      if (/\s/.test(character)) {
        fragment.append(document.createTextNode(character));
        return;
      }

      const span = document.createElement("span");
      span.className = "decode-char is-resolved";
      span.textContent = character;
      span.setAttribute("aria-hidden", "true");
      fragment.append(span);
    });
  }

  function createScrambleTail(remainingCount) {
    const tail = document.createElement("span");
    tail.className = "decode-tail";
    tail.setAttribute("aria-hidden", "true");
    const tailLength = Math.min(SCRAMBLE_TAIL_LENGTH, remainingCount);

    for (let index = 0; index < tailLength; index += 1) {
      const span = document.createElement("span");
      span.className = "decode-char is-scrambling";
      span.textContent = randomCipherGlyph();
      span.style.setProperty("--trail-distance", `${index}`);
      tail.append(span);
    }

    return tail;
  }

  function shuffleScrambleTail(tail) {
    tail?.querySelectorAll(".is-scrambling").forEach((span) => {
      span.textContent = randomCipherGlyph();
    });
  }

  async function scrambleToText(element, finalText, options = {}) {
    if (!finalText || prefersReducedMotion()) {
      element.textContent = finalText;
      element.removeAttribute("aria-label");
      options.onLayout?.();
      return;
    }

    const revealUnits = createRevealUnits(finalText);
    const settleDelay = 220;
    const settleTail = 190;
    const maximumRevealDuration = MAX_SCRAMBLE_DURATION - settleDelay - settleTail - 80;
    const revealDuration = Math.min(
      maximumRevealDuration,
      Math.max(180, revealUnits.length * 105),
    );
    const duration = settleDelay + revealDuration;
    const startedAt = performance.now();
    let resolvedCount = 0;
    let lastShuffleAt = 0;
    let scrambleTail = createScrambleTail(revealUnits.length);

    element.replaceChildren(scrambleTail);
    element.removeAttribute("aria-label");
    element.setAttribute("aria-busy", "true");
    element.classList.add("is-decrypting");
    options.onLayout?.();

    await new Promise((resolve) => {
      function frame(timestamp) {
        const elapsed = timestamp - startedAt;
        const progress = Math.min(1, elapsed / duration);
        const nextResolvedCount =
          elapsed < settleDelay || !revealUnits.length
            ? 0
            : Math.min(
                revealUnits.length,
                Math.floor(((elapsed - settleDelay) / revealDuration) * revealUnits.length) + 1,
              );

        if (resolvedCount < nextResolvedCount) {
          scrambleTail.remove();
          const fragment = document.createDocumentFragment();

          while (resolvedCount < nextResolvedCount) {
            appendResolvedUnit(fragment, revealUnits[resolvedCount]);
            resolvedCount += 1;
          }

          element.append(fragment);
          scrambleTail =
            resolvedCount < revealUnits.length
              ? createScrambleTail(revealUnits.length - resolvedCount)
              : null;

          if (scrambleTail) {
            element.append(scrambleTail);
          }

          options.onLayout?.();
        }

        if (timestamp - lastShuffleAt >= 58) {
          shuffleScrambleTail(scrambleTail);
          lastShuffleAt = timestamp;
        }

        if (progress < 1 || resolvedCount < revealUnits.length) {
          window.requestAnimationFrame(frame);
          return;
        }
        resolve();
      }

      window.requestAnimationFrame(frame);
    });

    await wait(settleTail);
    element.classList.remove("is-decrypting");
    element.setAttribute("aria-label", finalText);
    element.setAttribute("aria-busy", "false");
  }

  async function destroyText(element, options = {}) {
    const text = element.textContent;

    if (!text || prefersReducedMotion()) {
      element.replaceChildren();
      element.removeAttribute("aria-label");
      element.removeAttribute("aria-busy");
      return;
    }

    const { spans } = createCharacterSpans(element, text);
    const destroyOrder = spans.filter(Boolean).reverse();
    const characterDuration = 280;
    const naturalInterval = 120;
    const compressedInterval =
      (MAX_DESTROY_DURATION - characterDuration - 50) / Math.max(1, destroyOrder.length - 1);
    const destroyInterval = Math.min(naturalInterval, compressedInterval);
    const duration =
      destroyOrder.length > 0
        ? characterDuration + destroyInterval * (destroyOrder.length - 1)
        : 0;
    const startedAt = performance.now();
    let destroyedCount = 0;

    element.setAttribute("aria-label", text);
    element.setAttribute("aria-busy", "true");
    element.classList.add("is-destroying");
    options.onLayout?.();

    await new Promise((resolve) => {
      function frame(timestamp) {
        const elapsed = timestamp - startedAt;
        const nextDestroyedCount = Math.min(
          destroyOrder.length,
          Math.floor(elapsed / destroyInterval) + 1,
        );

        while (destroyedCount < nextDestroyedCount) {
          destroyOrder[destroyedCount].classList.add("is-destroying");
          destroyedCount += 1;
        }

        if (elapsed < duration) {
          window.requestAnimationFrame(frame);
          return;
        }

        resolve();
      }

      window.requestAnimationFrame(frame);
    });

    element.classList.remove("is-destroying");
    element.removeAttribute("aria-label");
    element.setAttribute("aria-busy", "false");
    element.replaceChildren();
  }

  window.TextEffects = Object.freeze({
    destroyText,
    scrambleToText,
  });
})();
