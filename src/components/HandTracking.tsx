'use client';

import { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as handpose from '@tensorflow-models/handpose';

// Define hand connections for drawing skeleton
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],     // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],     // Index finger
  [0, 9], [9, 10], [10, 11], [11, 12], // Middle finger
  [0, 13], [13, 14], [14, 15], [15, 16], // Ring finger
  [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
  [5, 9], [9, 13], [13, 17]           // Palm connections
];

export default function HandTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let model: handpose.HandPose;
    let stream: MediaStream;
    let animationId: number;

    const initializeHandTracking = async () => {
      try {
        if (!videoRef.current || !canvasRef.current) return;

        // Initialize TensorFlow.js
        await tf.ready();

        // Load handpose model
        model = await handpose.load();

        // Initialize webcam
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: 640,
            height: 480,
            facingMode: 'user'
          }
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) {
              videoRef.current.play();
              detectHands();
            }
          };
        }

        setIsLoading(false);
      } catch (err) {
        console.error('Hand tracking initialization error:', err);
        setError('Failed to initialize hand tracking');
        setIsLoading(false);
      }
    };

    const detectHands = async () => {
      if (!videoRef.current || !canvasRef.current || !model) return;

      try {
        const predictions = await model.estimateHands(videoRef.current);
        drawResults(predictions);
        
        animationId = requestAnimationFrame(detectHands);
      } catch (err) {
        console.error('Hand detection error:', err);
      }
    };

    const drawResults = (predictions: handpose.AnnotatedPrediction[]) => {
      if (!canvasRef.current || !videoRef.current) return;

      const canvasCtx = canvasRef.current.getContext('2d');
      if (!canvasCtx) return;

      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Draw mirrored video frame
      canvasCtx.scale(-1, 1);
      canvasCtx.drawImage(videoRef.current, -canvasRef.current.width, 0, canvasRef.current.width, canvasRef.current.height);
      canvasCtx.scale(-1, 1);

      // Draw hand landmarks and connections
      for (const prediction of predictions) {
        if (prediction.landmarks) {
          // Draw connections
          canvasCtx.strokeStyle = '#00FF00';
          canvasCtx.lineWidth = 2;
          for (const connection of HAND_CONNECTIONS) {
            const [startIdx, endIdx] = connection;
            const startPoint = prediction.landmarks[startIdx];
            const endPoint = prediction.landmarks[endIdx];
            
            if (startPoint && endPoint) {
              canvasCtx.beginPath();
              canvasCtx.moveTo(canvasRef.current.width - startPoint[0], startPoint[1]);
              canvasCtx.lineTo(canvasRef.current.width - endPoint[0], endPoint[1]);
              canvasCtx.stroke();
            }
          }

          // Draw landmarks
          canvasCtx.fillStyle = '#FF0000';
          for (const landmark of prediction.landmarks) {
            canvasCtx.beginPath();
            canvasCtx.arc(canvasRef.current.width - landmark[0], landmark[1], 3, 0, 2 * Math.PI);
            canvasCtx.fill();
          }
        }
      }
      canvasCtx.restore();
    };

    initializeHandTracking();

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (model) {
        model.dispose();
      }
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-white z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
              <p>Initializing hand tracking...</p>
            </div>
          </div>
        )}
        
        <video
          ref={videoRef}
          className="absolute opacity-0"
          width="640"
          height="480"
          autoPlay
          playsInline
          muted
        />
        
        <canvas
          ref={canvasRef}
          className="border-2 border-gray-600 rounded-lg"
          width="640"
          height="480"
        />
      </div>
    </div>
  );
}