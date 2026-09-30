# ADR-008: Expo for iOS and Android

- **Status:** Accepted
- **Date:** 2026-09-29

## Context
Need both platforms with background audio, PiP, and gestures, built mostly by one developer with Claude Code.

## Decision
Expo (React Native) with `expo-video`, sharing API types and client with web via `packages/shared`.

## Consequences
One codebase, native player features through config plugins, EAS for builds and store submission.
