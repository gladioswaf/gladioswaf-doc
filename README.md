# 🛡️ GladiosWAF Documentation

> **AI-Powered · Rule-Free · Zero-Trust Web Application Firewall**

---
## Table of Contents

1. [Introduction](#introduction)
2. [Why GladiosWAF](#why-gladioswaf)
3. [Architecture Overview](#architecture-overview)
4. [Core Concepts](#core-concepts)
5. [How GladiosWAF Works](#how-gladioswaf-works)
6. [Getting Started](#getting-started)
7. [API Authentication and App Binding](#api-authentication-and-app-binding)
8. [Request and Response Format](#request-and-response-format)
9. [Threat Detection Coverage](#threat-detection-coverage)
10. [Logging and Analytics](#logging-and-analytics)
11. [Deployment Modes](#deployment-modes)
12. [Performance and Limits](#performance-and-limits)
13. [Configuration](#configuration)
14. [Security and Trust Model](#security-and-trust-model)
15. [Troubleshooting](#troubleshooting)
16. [FAQ](#faq)
17. [Roadmap](#roadmap)
18. [Glossary](#glossary)
19. [Legal and Compliance](#legal-and-compliance)


---

## Introduction

**GladiosWAF** is an **AI-powered, rule-free Web Application Firewall (WAF)** designed to protect modern applications from malicious traffic without relying on static signatures, regex rules, or manual tuning.

Traditional WAFs depend on predefined patterns that attackers can easily bypass. GladiosWAF uses **machine learning inference** to evaluate requests based on structural and statistical behavior—allowing it to detect both known and unknown attacks.

---

## Why GladiosWAF

### Limitations of Traditional WAFs

- Signature and rule maintenance overhead
- High false positives
- Easily bypassed via encoding and obfuscation
- Slow adaptation to new attack vectors
- Complex tuning per application

### GladiosWAF Advantages

- ✅ Zero rulesets
- ✅ No signatures
- ✅ No manual tuning
- ✅ AI/ML-based detection
- ✅ Low false positives
- ✅ Effective against zero-day patterns

---

## Architecture Overview

GladiosWAF is built with a modular architecture to support cloud, on-premise, and edge deployments.

### High-Level Request Flow


### Core Components

- **Ingress Layer** – Receives and normalizes HTTP requests
- **Feature Extraction Engine** – Converts requests into ML-ready features
- **AI/ML Inference Service** – Predicts malicious vs benign traffic
- **Decision Engine** – Applies confidence thresholds
- **API Key & App Binding Service** – Prevents misuse
- **Logging & Analytics Backend** – Observability and insights

---

## Core Concepts

### Zero-Rule Detection

GladiosWAF does **not** rely on:
- Regex patterns
- OWASP CRS rules
- Signature databases

Detection is performed using **machine-learned behavior patterns**.

---

### Prediction vs Classification

GladiosWAF focuses on **prediction first**, classification second.

| Capability | Description |
|----------|-------------|
| Prediction | Determines whether a request is malicious |
| Classification | Optional labeling (e.g. SQLi, XSS) |

> A request can be blocked even if the exact attack type is unknown.

---

### What Is Inspected

Depending on configuration and deployment mode:

- URL path
- Query parameters
- HTTP headers
- Cookies
- Request body (optional)
- Metadata (length, entropy, structure)

> Raw payload storage is **disabled by default**.

---

## How GladiosWAF Works

### Decision Pipeline

1. Request normalization
2. Feature extraction
3. ML inference
4. Confidence scoring
5. Threshold evaluation
6. Allow or block decision
7. Optional attack labeling
8. Logging and metrics

### Decision Logic

```text
If confidence_score ≥ threshold → BLOCK
Else → ALLOW


