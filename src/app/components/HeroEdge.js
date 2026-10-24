'use client';

import { useEffect, useRef, useState } from 'react';

export default function Hero() {
    const sectionRef = useRef(null);
    const [gradientPos, setGradientPos] = useState('50%');

    // Background animation (kept from your existing version)
    useEffect(() => {
        const section = sectionRef.current;
        let posX = 0;
        let posY = 0;
        let velocityX = (Math.random() - 0.5) * 2;
        let velocityY = (Math.random() - 0.5) * 2;
        let animationFrame;

        const handleMouseMove = (e) => {
            const centerX = window.innerWidth / 2;
            const deltaX = (e.clientX - centerX) / centerX;
            velocityX = deltaX * 2;

            // 👇 Text gradient position control
            const percentX = (e.clientX / window.innerWidth) * 100;
            setGradientPos(`${percentX}%`);
        };

        const animate = () => {
            posX += velocityX;
            posY += velocityY;

            if (section) {
                section.style.backgroundPosition = `${posX}px ${posY}px`;
            }

            animationFrame = requestAnimationFrame(animate);
        };

        document.addEventListener('mousemove', handleMouseMove);
        animate();

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            cancelAnimationFrame(animationFrame);
        };
    }, []);

    return (
        <section
            ref={sectionRef}
            className="relative bg-gray-900 overflow-hidden"

        >
            {/* White radial overlay */}
            <div
                className="h-full w-full"

            >
                <div className="container mx-auto px-4 py-10 text-center relative z-10 pointer-events-auto">
                    <div className="text-center h-full items-center flex w-full">
                        <div className="w-full justify-center">
                            <img src="/assets/icon2.png" alt="Extend Campaign" className="mx-auto mb-4 w-16 h-16 mt-4 rounded" />

                            {/* Gradient text with cursor-based background position */}
                            <h2
                                className=" leading-none text-4xl sm:text-[100px] uppercase interBold text-white"
                            >
                                Premarket Edge
                            </h2>



                            <div className=" my-3 ">
                                <h2 className="leading-none text-xl inter bg-clip-text text-transparent" style={{
                                    backgroundImage: `linear-gradient(to right, #2384bb, #573ca3, #a73f79, #c1583b)`,
                                    backgroundSize: `200%`,
                                    backgroundPositionX: gradientPos,
                                }}>
                                    Sell your own home with ultra cheap flat fee.
                                </h2>
                            </div>

                            {/* <p className="text-sm mt-4 inter text-gray-500">
                No obligation, zero cost and real value
              </p> */}

                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
