// Minimal persisted-plan validation schema; presentation lives in frontend.
export const taskSchemas=[
  {
    "id": "sampling",
    "steps": [
      {
        "id": "model",
        "required": true
      },
      {
        "id": "learning",
        "required": false
      },
      {
        "id": "structure",
        "required": true
      },
      {
        "id": "md",
        "required": true
      },
      {
        "id": "bias",
        "required": true
      },
      {
        "id": "assets",
        "required": true
      },
      {
        "id": "analysis",
        "required": false
      }
    ]
  },
  {
    "id": "md",
    "steps": [
      {
        "id": "model",
        "required": true
      },
      {
        "id": "learning",
        "required": false
      },
      {
        "id": "structure",
        "required": true
      },
      {
        "id": "md",
        "required": true
      },
      {
        "id": "submit",
        "required": true
      },
      {
        "id": "assets",
        "required": true
      }
    ]
  },
  {
    "id": "training",
    "steps": [
      {
        "id": "dataset",
        "required": true
      },
      {
        "id": "train",
        "required": true
      },
      {
        "id": "evaluate",
        "required": true
      },
      {
        "id": "export",
        "required": true
      },
      {
        "id": "submit",
        "required": true
      },
      {
        "id": "assets",
        "required": true
      }
    ]
  },
  {
    "id": "learning",
    "steps": [
      {
        "id": "model",
        "required": true
      },
      {
        "id": "structure",
        "required": true
      },
      {
        "id": "explore",
        "required": true
      },
      {
        "id": "select",
        "required": true
      },
      {
        "id": "dft",
        "required": true
      },
      {
        "id": "retrain",
        "required": true
      },
      {
        "id": "submit",
        "required": true
      },
      {
        "id": "assets",
        "required": true
      }
    ]
  },
  {
    "id": "analysis",
    "steps": [
      {
        "id": "input",
        "required": true
      },
      {
        "id": "method",
        "required": true
      },
      {
        "id": "preview",
        "required": false
      },
      {
        "id": "submit",
        "required": true
      },
      {
        "id": "assets",
        "required": true
      }
    ]
  },
  {
    "id": "neb",
    "steps": [
      {
        "id": "model",
        "required": true
      },
      {
        "id": "endpoints",
        "required": true
      },
      {
        "id": "neb",
        "required": true
      },
      {
        "id": "assets",
        "required": true
      }
    ]
  },
  {
    "id": "request",
    "steps": [
      {
        "id": "input",
        "required": true
      },
      {
        "id": "target",
        "required": true
      },
      {
        "id": "process",
        "required": true
      },
      {
        "id": "submit",
        "required": true
      },
      {
        "id": "assets",
        "required": true
      }
    ]
  }
];
