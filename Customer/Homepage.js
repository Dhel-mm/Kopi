const wrapper = document.querySelector(".slider-wrapper");
  const slides = document.querySelectorAll(".slide");
  const nextBtn = document.querySelector(".next");
  const prevBtn = document.querySelector(".prev");
  const dots = document.querySelectorAll(".dot");

  let index = 0;
  const total = slides.length;

  function updateSlider() {
    wrapper.style.transform = `translateX(${-index * 100}%)`;

    dots.forEach(dot => dot.classList.remove("active"));
    dots[index].classList.add("active");
  }

  function autoSlide() {
    index = (index + 1) % total;
    updateSlider();
  }

  let interval = setInterval(autoSlide, 4000);

  function resetTimer() {
    clearInterval(interval);
    interval = setInterval(autoSlide, 5000);
  }

  nextBtn.addEventListener("click", () => {
    index = (index + 1) % total;
    updateSlider();
    resetTimer();
  });

  prevBtn.addEventListener("click", () => {
    index = (index - 1 + total) % total;
    updateSlider();
    resetTimer();
  });

  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => {
      index = i;
      updateSlider();
      resetTimer();
    });
    });
