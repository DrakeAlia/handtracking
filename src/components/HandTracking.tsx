"use client"

import React, { useRef, useEffect, useState, useCallback } from "react";
import * as tf from "@tensorflow/tfjs";
import * as handpose from "@tensorflow-models/handpose";
import CameraSelector from "./CameraSelector";

interface HandTrackingProps {
  cameraId?: string;
}

interface Hand {
  predictions: HandPrediction[];
  lastSeen: number;
}

interface HandPrediction {
  landmarks: number[][];
  handInViewConfidence: number;
  boundingBox: {
    topLeft: number[];
    bottomRight: number[];
  };
  region?: "full" | "left" | "right";
}

const HandTracking: React.FC<HandTrackingProps> = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [model, setModel] = useState<handpose.HandPose | null>(null);
  const [, setSelectedCamera] = useState<string | null>(null);
  const [showCameraSelector, setShowCameraSelector] = useState(true);
  const [error, setError] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);

  // Hand tracking state
  const leftHandRef = useRef<Hand>({ predictions: [], lastSeen: 0 });
  const rightHandRef = useRef<Hand>({ predictions: [], lastSeen: 0 });
  const animationFrameRef = useRef<number | undefined>(undefined);
  const streamRef = useRef<MediaStream | null>(null);

  // Remove duplicate hand detections
  const removeDuplicateHands = useCallback((predictions: HandPrediction[]) => {
    const filtered: HandPrediction[] = [];
    const threshold = 100; // Distance threshold for duplicates

    for (const pred of predictions) {
      const isDuplicate = filtered.some((existing) => {
        if (!pred.landmarks || !existing.landmarks) return false;

        // Calculate distance between wrist positions (landmark 0)
        const dist = Math.sqrt(
          Math.pow(pred.landmarks[0][0] - existing.landmarks[0][0], 2) +
            Math.pow(pred.landmarks[0][1] - existing.landmarks[0][1], 2)
        );

        return dist < threshold;
      });

      if (!isDuplicate) {
        filtered.push(pred);
      }
    }

    return filtered;
  }, []);

  // Apply temporal smoothing to landmarks
  const applyTemporalSmoothing = useCallback(
    (newLandmarks: number[][], oldLandmarks: number[][], factor: number) => {
      if (!oldLandmarks || oldLandmarks.length !== newLandmarks.length) {
        return newLandmarks;
      }

      return newLandmarks.map((landmark, i) => [
        landmark[0] * factor + oldLandmarks[i][0] * (1 - factor),
        landmark[1] * factor + oldLandmarks[i][1] * (1 - factor),
        landmark[2] * factor + oldLandmarks[i][2] * (1 - factor),
      ]);
    },
    []
  );

  // Assign hands to left/right trackers
  const assignHandsToTrackers = useCallback(
    (predictions: HandPrediction[], currentTime: number) => {
      if (predictions.length === 0) return;

      // Sort by x position (leftmost first)
      const sortedPredictions = predictions.sort((a, b) => {
        const aX = a.landmarks ? a.landmarks[0][0] : 0;
        const bX = b.landmarks ? b.landmarks[0][0] : 0;
        return aX - bX;
      });

      // Temporal smoothing factor
      const smoothingFactor = 0.4;

      if (sortedPredictions.length >= 2) {
        // Two hands detected
        const leftPred = sortedPredictions[0];
        const rightPred = sortedPredictions[1];

        // Apply temporal smoothing
        if (leftHandRef.current.predictions.length > 0) {
          leftPred.landmarks = applyTemporalSmoothing(
            leftPred.landmarks,
            leftHandRef.current.predictions[0].landmarks,
            smoothingFactor
          );
        }

        if (rightHandRef.current.predictions.length > 0) {
          rightPred.landmarks = applyTemporalSmoothing(
            rightPred.landmarks,
            rightHandRef.current.predictions[0].landmarks,
            smoothingFactor
          );
        }

        leftHandRef.current = {
          predictions: [leftPred],
          lastSeen: currentTime,
        };
        rightHandRef.current = {
          predictions: [rightPred],
          lastSeen: currentTime,
        };
      } else if (sortedPredictions.length === 1) {
        // One hand detected - assign to closest tracker
        const pred = sortedPredictions[0];
        const wristX = pred.landmarks ? pred.landmarks[0][0] : 0;
        const centerX = canvasRef.current ? canvasRef.current.width / 2 : 640;

        if (wristX < centerX) {
          // Left side
          if (leftHandRef.current.predictions.length > 0) {
            pred.landmarks = applyTemporalSmoothing(
              pred.landmarks,
              leftHandRef.current.predictions[0].landmarks,
              smoothingFactor
            );
          }
          leftHandRef.current = { predictions: [pred], lastSeen: currentTime };

          // Clear right hand if too old
          if (currentTime - rightHandRef.current.lastSeen > 500) {
            rightHandRef.current.predictions = [];
          }
        } else {
          // Right side
          if (rightHandRef.current.predictions.length > 0) {
            pred.landmarks = applyTemporalSmoothing(
              pred.landmarks,
              rightHandRef.current.predictions[0].landmarks,
              smoothingFactor
            );
          }
          rightHandRef.current = { predictions: [pred], lastSeen: currentTime };

          // Clear left hand if too old
          if (currentTime - leftHandRef.current.lastSeen > 500) {
            leftHandRef.current.predictions = [];
          }
        }
      }

      // Clear old predictions
      if (currentTime - leftHandRef.current.lastSeen > 1000) {
        leftHandRef.current.predictions = [];
      }
      if (currentTime - rightHandRef.current.lastSeen > 1000) {
        rightHandRef.current.predictions = [];
      }
    },
    [applyTemporalSmoothing]
  );

  // Draw hand skeleton
  const drawHandSkeleton = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      landmarks: number[][],
      palmColor: string,
      fingerColor: string
    ) => {
      // Hand connections based on MediaPipe hand model
      const connections = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4], // Thumb
        [0, 5],
        [5, 6],
        [6, 7],
        [7, 8], // Index finger
        [0, 9],
        [9, 10],
        [10, 11],
        [11, 12], // Middle finger
        [0, 13],
        [13, 14],
        [14, 15],
        [15, 16], // Ring finger
        [0, 17],
        [17, 18],
        [18, 19],
        [19, 20], // Pinky
        [5, 9],
        [9, 13],
        [13, 17], // Palm connections
      ];

      // Draw connections
      ctx.strokeStyle = fingerColor;
      ctx.lineWidth = 2;
      connections.forEach(([start, end]) => {
        if (landmarks[start] && landmarks[end]) {
          ctx.beginPath();
          ctx.moveTo(landmarks[start][0], landmarks[start][1]);
          ctx.lineTo(landmarks[end][0], landmarks[end][1]);
          ctx.stroke();
        }
      });

      // Draw landmarks
      landmarks.forEach((landmark, i) => {
        ctx.fillStyle = i === 0 ? palmColor : fingerColor; // Wrist in palm color, others in finger color
        ctx.beginPath();
        ctx.arc(landmark[0], landmark[1], i === 0 ? 8 : 4, 0, 2 * Math.PI);
        ctx.fill();
      });
    },
    []
  );

  // Draw hands with different colors
  const drawHands = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      leftHands: HandPrediction[],
      rightHands: HandPrediction[]
    ) => {
      // Draw left hand in green/red
      leftHands.forEach((hand) => {
        if (hand.landmarks) {
          drawHandSkeleton(ctx, hand.landmarks, "#00ff00", "#ff0000"); // Green palm, red fingers
        }
      });

      // Draw right hand in cyan/magenta
      rightHands.forEach((hand) => {
        if (hand.landmarks) {
          drawHandSkeleton(ctx, hand.landmarks, "#00ffff", "#ff00ff"); // Cyan palm, magenta fingers
        }
      });
    },
    [drawHandSkeleton]
  );

  // Start hand detection
  const startDetection = useCallback(() => {
    if (!model || !videoRef.current || !canvasRef.current) return;

    const detectHands = async () => {
      if (!videoRef.current || !canvasRef.current || !model) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      if (!ctx || video.readyState !== 4) {
        animationFrameRef.current = requestAnimationFrame(detectHands);
        return;
      }

      // Set canvas size to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      try {
        // Detect hands in full frame
        const fullFramePredictions = await model.estimateHands(video);

        // Multi-region detection for better dual-hand tracking
        const leftRegionCanvas = document.createElement("canvas");
        const leftCtx = leftRegionCanvas.getContext("2d");
        const rightRegionCanvas = document.createElement("canvas");
        const rightCtx = rightRegionCanvas.getContext("2d");

        if (leftCtx && rightCtx) {
          const halfWidth = canvas.width / 2;

          // Setup region canvases
          leftRegionCanvas.width = halfWidth;
          leftRegionCanvas.height = canvas.height;
          rightRegionCanvas.width = halfWidth;
          rightRegionCanvas.height = canvas.height;

          // Draw left and right regions
          leftCtx.drawImage(
            video,
            0,
            0,
            halfWidth,
            canvas.height,
            0,
            0,
            halfWidth,
            canvas.height
          );
          rightCtx.drawImage(
            video,
            halfWidth,
            0,
            halfWidth,
            canvas.height,
            0,
            0,
            halfWidth,
            canvas.height
          );

          // Detect in regions
          const leftRegionPredictions = await model.estimateHands(
            leftRegionCanvas
          );
          const rightRegionPredictions = await model.estimateHands(
            rightRegionCanvas
          );

          // Process and assign hands
          const currentTime = Date.now();
          const allPredictions = [
            ...fullFramePredictions.map((p) => ({
              ...p,
              region: "full" as const,
            })),
            ...leftRegionPredictions.map((p) => ({
              ...p,
              region: "left" as const,
              landmarks: p.landmarks.map((landmark: number[]) => [
                landmark[0],
                landmark[1],
                landmark[2],
              ]),
            })),
            ...rightRegionPredictions.map((p) => ({
              ...p,
              region: "right" as const,
              landmarks: p.landmarks.map((landmark: number[]) => [
                landmark[0] + halfWidth,
                landmark[1],
                landmark[2],
              ]),
            })),
          ];

          // Remove duplicates and assign to hands
          const processedPredictions = removeDuplicateHands(allPredictions);

          // Assign hands based on position and temporal smoothing
          assignHandsToTrackers(processedPredictions, currentTime);

          // Draw hands with color coding
          drawHands(
            ctx,
            leftHandRef.current.predictions,
            rightHandRef.current.predictions
          );
        }
      } catch (err) {
        console.error("Error during hand detection:", err);
      }

      animationFrameRef.current = requestAnimationFrame(detectHands);
    };

    detectHands();
  }, [model, assignHandsToTrackers, drawHands, removeDuplicateHands]);

  // Initialize TensorFlow.js and load the handpose model
  useEffect(() => {
    const initializeModel = async () => {
      try {
        await tf.ready();
        const handposeModel = await handpose.load();
        setModel(handposeModel);
        setIsLoading(false);
      } catch (err) {
        console.error("Error loading handpose model:", err);
        setError("Failed to load hand tracking model");
        setIsLoading(false);
      }
    };

    initializeModel();
  }, []);

  // Handle camera selection
  const handleCameraSelect = useCallback(
    async (deviceId: string) => {
      setSelectedCamera(deviceId);
      setShowCameraSelector(false);

      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          streamRef.current = stream;

          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) {
              videoRef.current.play();
              setIsStreaming(true);
              startDetection();
            }
          };
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        setError("Failed to access camera. Please check permissions.");
      }
    },
    [startDetection]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-24 h-24 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-cyan-400 font-mono text-xl tracking-wider">
            LOADING NEURAL NETWORK...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="relative">
          <div className="absolute inset-0 bg-red-500 opacity-20 blur-xl"></div>
          <div className="relative bg-black border-2 border-red-500 text-white p-8 max-w-md shadow-2xl shadow-red-500/50">
            <div className="flex items-center mb-4">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mr-2"></div>
              <h2 className="text-xl font-mono font-bold text-red-400">
                SYSTEM ERROR
              </h2>
            </div>
            <p className="font-mono text-sm">{error}</p>
            <button
              onClick={() => {
                setError("");
                setShowCameraSelector(true);
              }}
              className="mt-4 w-full bg-red-900 border-2 border-red-500 text-red-100 font-mono font-bold py-2 px-4 tracking-wider hover:bg-red-800 transition-colors"
            >
              RETRY
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (showCameraSelector) {
    return <CameraSelector onCameraSelect={handleCameraSelect} />;
  }

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div className="relative w-full h-full">
        {/* Video Element */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          muted
          playsInline
        />

        {/* Hand Tracking Canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />

        {/* Controls */}
        <div className="absolute top-4 left-4 flex gap-4">
          <button
            onClick={() => {
              setShowCameraSelector(true);
              if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
              }
              if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
              }
            }}
            className="bg-gray-900 bg-opacity-80 border-2 border-cyan-500 text-cyan-100 font-mono font-bold py-2 px-4 tracking-wider hover:bg-cyan-900 transition-colors"
          >
            CHANGE CAMERA
          </button>
        </div>

        {/* Status Indicator */}
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${
              isStreaming ? "bg-green-400 animate-pulse" : "bg-red-400"
            }`}
          ></div>
          <span className="text-white font-mono text-sm">
            {isStreaming ? "TRACKING ACTIVE" : "CONNECTING..."}
          </span>
        </div>

        {/* Hand Status */}
        <div className="absolute bottom-4 left-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-400 rounded-full"></div>
            <span className="text-white font-mono text-sm">
              LEFT HAND:{" "}
              {leftHandRef.current.predictions.length > 0
                ? "DETECTED"
                : "NOT DETECTED"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-cyan-400 rounded-full"></div>
            <span className="text-white font-mono text-sm">
              RIGHT HAND:{" "}
              {rightHandRef.current.predictions.length > 0
                ? "DETECTED"
                : "NOT DETECTED"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HandTracking;
