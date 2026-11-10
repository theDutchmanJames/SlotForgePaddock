'use strict';
// Read-only shapes from Paddock shared-racing-history-v1/qualified/schema.json, 2026-11-09.
// Explicitly not a capability or public write/approval schema.
module.exports={
 "body": {
  "type": "object",
  "properties": {
   "format": {
    "const": "history-v1"
   },
   "provenance": {
    "type": "object",
    "properties": {
     "kind": {
      "enum": [
       "measured",
       "historical"
      ]
     },
     "evidence": {
      "type": "string",
      "maxLength": 2000
     },
     "missing": {
      "type": "array",
      "items": {
       "enum": [
        "configuration",
        "crossing-times",
        "driver-boundaries",
        "lane-lengths",
        "classification",
        "record-eligibility",
        "race-date"
       ]
      },
      "maxItems": 7
     }
    },
    "required": [
     "kind",
     "evidence",
     "missing"
    ],
    "additionalProperties": false
   },
   "race": {
    "type": "object",
    "properties": {
     "name": {
      "type": "string",
      "maxLength": 200
     },
     "type": {
      "enum": [
       "practice",
       "qualifying",
       "race",
       "endurance"
      ]
     },
     "startedAt": {
      "anyOf": [
       {
        "type": "string",
        "format": "date-time",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
       },
       {
        "type": "null"
       }
      ]
     },
     "endedAt": {
      "anyOf": [
       {
        "type": "string",
        "format": "date-time",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
       },
       {
        "type": "null"
       }
      ]
     },
     "track": {
      "type": "object",
      "properties": {
       "id": {
        "anyOf": [
         {
          "type": "string",
          "minLength": 1,
          "maxLength": 100,
          "pattern": "^[a-zA-Z0-9_-]+$"
         },
         {
          "type": "null"
         }
        ]
       },
       "name": {
        "type": "string",
        "maxLength": 200
       },
       "lanes": {
        "type": "array",
        "items": {
         "type": "object",
         "properties": {
          "lane": {
           "type": "integer",
           "minimum": 1,
           "maximum": 64
          },
          "lengthM": {
           "anyOf": [
            {
             "type": "number",
             "minimum": 0,
             "maximum": 100000
            },
            {
             "type": "null"
            }
           ]
          }
         },
         "required": [
          "lane",
          "lengthM"
         ],
         "additionalProperties": false
        },
        "maxItems": 64
       }
      },
      "required": [
       "id",
       "name",
       "lanes"
      ],
      "additionalProperties": false
     },
     "heats": {
      "type": "array",
      "items": {
       "type": "object",
       "properties": {
        "id": {
         "type": "string",
         "minLength": 1,
         "maxLength": 100,
         "pattern": "^[a-zA-Z0-9_-]+$"
        },
        "name": {
         "type": "string",
         "maxLength": 200
        },
        "startedAtMs": {
         "anyOf": [
          {
           "type": "number",
           "minimum": 0,
           "maximum": 604800000
          },
          {
           "type": "null"
          }
         ]
        },
        "endedAtMs": {
         "anyOf": [
          {
           "type": "number",
           "minimum": 0,
           "maximum": 604800000
          },
          {
           "type": "null"
          }
         ]
        }
       },
       "required": [
        "id",
        "name",
        "startedAtMs",
        "endedAtMs"
       ],
       "additionalProperties": false
      },
      "maxItems": 1000
     },
     "participants": {
      "type": "array",
      "items": {
       "type": "object",
       "properties": {
        "id": {
         "type": "string",
         "minLength": 1,
         "maxLength": 100,
         "pattern": "^[a-zA-Z0-9_-]+$"
        },
        "kind": {
         "enum": [
          "physical",
          "virtual"
         ]
        },
        "carId": {
         "anyOf": [
          {
           "type": "string",
           "minLength": 1,
           "maxLength": 100,
           "pattern": "^[a-zA-Z0-9_-]+$"
          },
          {
           "type": "null"
          }
         ]
        },
        "configuration": {
         "anyOf": [
          {
           "type": "object",
           "properties": {
            "databaseId": {
             "type": "string",
             "minLength": 1,
             "maxLength": 100,
             "pattern": "^[a-zA-Z0-9_-]+$"
            },
            "carId": {
             "type": "string",
             "minLength": 1,
             "maxLength": 100,
             "pattern": "^[a-zA-Z0-9_-]+$"
            },
            "kind": {
             "const": "current"
            },
            "configurationId": {
             "type": "string",
             "pattern": "^[a-f0-9]{64}$"
            },
            "revision": {
             "type": "string",
             "pattern": "^[a-f0-9]{64}$"
            },
            "carRevision": {
             "type": "integer",
             "minimum": 1,
             "maximum": 9007199254740991
            },
            "capturedAt": {
             "type": "string",
             "minLength": 1,
             "maxLength": 24,
             "format": "date-time",
             "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
            },
            "technical": {
             "type": "object",
             "properties": {
              "body": {
               "type": "string",
               "maxLength": 20000
              },
              "bodyMaterial": {
               "type": "string",
               "maxLength": 20000
              },
              "bodySettings": {
               "type": "string",
               "maxLength": 20000
              },
              "chassis": {
               "type": "string",
               "maxLength": 20000
              },
              "wheelbase": {
               "type": "string",
               "maxLength": 20000
              },
              "motor": {
               "type": "string",
               "maxLength": 20000
              },
              "motorLayout": {
               "type": "string",
               "maxLength": 20000
              },
              "pod": {
               "type": "string",
               "maxLength": 20000
              },
              "podSettings": {
               "type": "string",
               "maxLength": 20000
              },
              "ratedRpm": {
               "type": "string",
               "maxLength": 20000
              },
              "ratedVoltage": {
               "type": "string",
               "maxLength": 20000
              },
              "measuredRpm": {
               "type": "string",
               "maxLength": 20000
              },
              "measuredVoltage": {
               "type": "string",
               "maxLength": 20000
              },
              "measuredDate": {
               "type": "string",
               "maxLength": 20000
              },
              "pinion": {
               "type": "string",
               "maxLength": 20000
              },
              "gear": {
               "type": "string",
               "maxLength": 20000
              },
              "gearType": {
               "type": "string",
               "maxLength": 20000
              },
              "pinionPart": {
               "type": "string",
               "maxLength": 20000
              },
              "gearPart": {
               "type": "string",
               "maxLength": 20000
              },
              "frontAxle": {
               "type": "string",
               "maxLength": 20000
              },
              "rearAxle": {
               "type": "string",
               "maxLength": 20000
              },
              "frontBearings": {
               "type": "string",
               "maxLength": 20000
              },
              "rearBearings": {
               "type": "string",
               "maxLength": 20000
              },
              "frontWheels": {
               "type": "string",
               "maxLength": 20000
              },
              "rearWheels": {
               "type": "string",
               "maxLength": 20000
              },
              "frontTyres": {
               "type": "string",
               "maxLength": 20000
              },
              "rearTyres": {
               "type": "string",
               "maxLength": 20000
              },
              "frontDiameter": {
               "type": "string",
               "maxLength": 20000
              },
              "rearDiameter": {
               "type": "string",
               "maxLength": 20000
              },
              "frontAxlePlay": {
               "type": "string",
               "maxLength": 20000
              },
              "rearAxlePlay": {
               "type": "string",
               "maxLength": 20000
              },
              "guide": {
               "type": "string",
               "maxLength": 20000
              },
              "braids": {
               "type": "string",
               "maxLength": 20000
              },
              "wiring": {
               "type": "string",
               "maxLength": 20000
              },
              "lights": {
               "type": "string",
               "maxLength": 20000
              },
              "digitalSystem": {
               "type": "string",
               "maxLength": 20000
              },
              "chip": {
               "type": "string",
               "maxLength": 20000
              },
              "magnets": {
               "type": "string",
               "maxLength": 20000
              },
              "ballast": {
               "type": "string",
               "maxLength": 20000
              },
              "suspension": {
               "type": "string",
               "maxLength": 20000
              },
              "fasteners": {
               "type": "string",
               "maxLength": 20000
              },
              "weight": {
               "type": "string",
               "maxLength": 20000
              },
              "clearance": {
               "type": "string",
               "maxLength": 20000
              },
              "frontWidth": {
               "type": "string",
               "maxLength": 20000
              },
              "rearWidth": {
               "type": "string",
               "maxLength": 20000
              },
              "motorTorque": {
               "type": "string",
               "maxLength": 20000
              },
              "torqueVoltage": {
               "type": "string",
               "maxLength": 20000
              },
              "torqueType": {
               "type": "string",
               "maxLength": 20000
              },
              "motorType": {
               "type": "string",
               "maxLength": 20000
              }
             },
             "additionalProperties": false
            },
            "components": {
             "type": "array",
             "items": {
              "type": "object",
              "properties": {
               "partId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 100,
                "pattern": "^[a-zA-Z0-9_-]+$"
               },
               "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
               },
               "quantity": {
                "type": "integer",
                "minimum": 1,
                "maximum": 1000000
               },
               "field": {
                "type": "string",
                "maxLength": 100
               },
               "position": {
                "type": "string",
                "maxLength": 160
               },
               "assemblyId": {
                "anyOf": [
                 {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 100,
                  "pattern": "^[a-zA-Z0-9_-]+$"
                 },
                 {
                  "type": "null"
                 }
                ]
               }
              },
              "required": [
               "partId",
               "name",
               "quantity",
               "field",
               "position",
               "assemblyId"
              ],
              "additionalProperties": false
             },
             "maxItems": 1000,
             "minItems": 0
            },
            "signature": {
             "type": "string",
             "pattern": "^[a-f0-9]{64}$"
            }
           },
           "required": [
            "databaseId",
            "carId",
            "kind",
            "configurationId",
            "revision",
            "carRevision",
            "capturedAt",
            "technical",
            "components",
            "signature"
           ],
           "additionalProperties": false
          },
          {
           "type": "object",
           "properties": {
            "kind": {
             "const": "historical"
            },
            "technical": {
             "type": "object",
             "properties": {
              "body": {
               "type": "string",
               "maxLength": 20000
              },
              "bodyMaterial": {
               "type": "string",
               "maxLength": 20000
              },
              "bodySettings": {
               "type": "string",
               "maxLength": 20000
              },
              "chassis": {
               "type": "string",
               "maxLength": 20000
              },
              "wheelbase": {
               "type": "string",
               "maxLength": 20000
              },
              "motor": {
               "type": "string",
               "maxLength": 20000
              },
              "motorLayout": {
               "type": "string",
               "maxLength": 20000
              },
              "pod": {
               "type": "string",
               "maxLength": 20000
              },
              "podSettings": {
               "type": "string",
               "maxLength": 20000
              },
              "ratedRpm": {
               "type": "string",
               "maxLength": 20000
              },
              "ratedVoltage": {
               "type": "string",
               "maxLength": 20000
              },
              "measuredRpm": {
               "type": "string",
               "maxLength": 20000
              },
              "measuredVoltage": {
               "type": "string",
               "maxLength": 20000
              },
              "measuredDate": {
               "type": "string",
               "maxLength": 20000
              },
              "pinion": {
               "type": "string",
               "maxLength": 20000
              },
              "gear": {
               "type": "string",
               "maxLength": 20000
              },
              "gearType": {
               "type": "string",
               "maxLength": 20000
              },
              "pinionPart": {
               "type": "string",
               "maxLength": 20000
              },
              "gearPart": {
               "type": "string",
               "maxLength": 20000
              },
              "frontAxle": {
               "type": "string",
               "maxLength": 20000
              },
              "rearAxle": {
               "type": "string",
               "maxLength": 20000
              },
              "frontBearings": {
               "type": "string",
               "maxLength": 20000
              },
              "rearBearings": {
               "type": "string",
               "maxLength": 20000
              },
              "frontWheels": {
               "type": "string",
               "maxLength": 20000
              },
              "rearWheels": {
               "type": "string",
               "maxLength": 20000
              },
              "frontTyres": {
               "type": "string",
               "maxLength": 20000
              },
              "rearTyres": {
               "type": "string",
               "maxLength": 20000
              },
              "frontDiameter": {
               "type": "string",
               "maxLength": 20000
              },
              "rearDiameter": {
               "type": "string",
               "maxLength": 20000
              },
              "frontAxlePlay": {
               "type": "string",
               "maxLength": 20000
              },
              "rearAxlePlay": {
               "type": "string",
               "maxLength": 20000
              },
              "guide": {
               "type": "string",
               "maxLength": 20000
              },
              "braids": {
               "type": "string",
               "maxLength": 20000
              },
              "wiring": {
               "type": "string",
               "maxLength": 20000
              },
              "lights": {
               "type": "string",
               "maxLength": 20000
              },
              "digitalSystem": {
               "type": "string",
               "maxLength": 20000
              },
              "chip": {
               "type": "string",
               "maxLength": 20000
              },
              "magnets": {
               "type": "string",
               "maxLength": 20000
              },
              "ballast": {
               "type": "string",
               "maxLength": 20000
              },
              "suspension": {
               "type": "string",
               "maxLength": 20000
              },
              "fasteners": {
               "type": "string",
               "maxLength": 20000
              },
              "weight": {
               "type": "string",
               "maxLength": 20000
              },
              "clearance": {
               "type": "string",
               "maxLength": 20000
              },
              "frontWidth": {
               "type": "string",
               "maxLength": 20000
              },
              "rearWidth": {
               "type": "string",
               "maxLength": 20000
              },
              "motorTorque": {
               "type": "string",
               "maxLength": 20000
              },
              "torqueVoltage": {
               "type": "string",
               "maxLength": 20000
              },
              "torqueType": {
               "type": "string",
               "maxLength": 20000
              },
              "motorType": {
               "type": "string",
               "maxLength": 20000
              }
             },
             "additionalProperties": false
            },
            "recordedAt": {
             "anyOf": [
              {
               "type": "string",
               "format": "date-time",
               "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
              },
              {
               "type": "null"
              }
             ]
            },
            "evidence": {
             "type": "string",
             "maxLength": 2000
            }
           },
           "required": [
            "kind",
            "technical",
            "recordedAt",
            "evidence"
           ],
           "additionalProperties": false
          },
          {
           "type": "null"
          }
         ]
        },
        "displayName": {
         "type": "string",
         "maxLength": 200
        },
        "teamId": {
         "anyOf": [
          {
           "type": "string",
           "minLength": 1,
           "maxLength": 100,
           "pattern": "^[a-zA-Z0-9_-]+$"
          },
          {
           "type": "null"
          }
         ]
        },
        "drivers": {
         "type": "array",
         "items": {
          "type": "object",
          "properties": {
           "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
            "pattern": "^[a-zA-Z0-9_-]+$"
           },
           "name": {
            "type": "string",
            "maxLength": 200
           }
          },
          "required": [
           "id",
           "name"
          ],
          "additionalProperties": false
         },
         "maxItems": 100
        },
        "stints": {
         "type": "array",
         "items": {
          "type": "object",
          "properties": {
           "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
            "pattern": "^[a-zA-Z0-9_-]+$"
           },
           "heatId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
            "pattern": "^[a-zA-Z0-9_-]+$"
           },
           "driverId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
            "pattern": "^[a-zA-Z0-9_-]+$"
           },
           "lane": {
            "type": "integer",
            "minimum": 1,
            "maximum": 64
           },
           "startedAtMs": {
            "anyOf": [
             {
              "type": "number",
              "minimum": 0,
              "maximum": 604800000
             },
             {
              "type": "null"
             }
            ]
           },
           "endedAtMs": {
            "anyOf": [
             {
              "type": "number",
              "minimum": 0,
              "maximum": 604800000
             },
             {
              "type": "null"
             }
            ]
           }
          },
          "required": [
           "id",
           "heatId",
           "driverId",
           "lane",
           "startedAtMs",
           "endedAtMs"
          ],
          "additionalProperties": false
         },
         "maxItems": 2000
        }
       },
       "required": [
        "id",
        "kind",
        "carId",
        "configuration",
        "displayName",
        "teamId",
        "drivers",
        "stints"
       ],
       "additionalProperties": false
      },
      "maxItems": 256
     }
    },
    "required": [
     "name",
     "type",
     "startedAt",
     "endedAt",
     "track",
     "heats",
     "participants"
    ],
    "additionalProperties": false
   },
   "context": {
    "type": "object",
    "properties": {
     "savedAt": {
      "anyOf": [
       {
        "type": "string",
        "format": "date-time",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
       },
       {
        "type": "null"
       }
      ]
     },
     "endedBy": {
      "anyOf": [
       {
        "type": "string",
        "maxLength": 200
       },
       {
        "type": "null"
       }
      ]
     },
     "resumed": {
      "anyOf": [
       {
        "type": "integer",
        "minimum": 0,
        "maximum": 100000
       },
       {
        "type": "null"
       }
      ]
     },
     "weather": {
      "anyOf": [
       {
        "type": "string",
        "maxLength": 2000
       },
       {
        "type": "null"
       }
      ]
     },
     "teams": {
      "type": "array",
      "items": {
       "type": "object",
       "properties": {
        "id": {
         "type": "string",
         "minLength": 1,
         "maxLength": 100,
         "pattern": "^[a-zA-Z0-9_-]+$"
        },
        "name": {
         "type": "string",
         "maxLength": 200
        }
       },
       "required": [
        "id",
        "name"
       ],
       "additionalProperties": false
      },
      "maxItems": 256
     },
     "classes": {
      "type": "array",
      "items": {
       "type": "object",
       "properties": {
        "id": {
         "type": "string",
         "minLength": 1,
         "maxLength": 100,
         "pattern": "^[a-zA-Z0-9_-]+$"
        },
        "name": {
         "type": "string",
         "maxLength": 200
        }
       },
       "required": [
        "id",
        "name"
       ],
       "additionalProperties": false
      },
      "maxItems": 256
     },
     "classification": {
      "type": "array",
      "items": {
       "type": "object",
       "properties": {
        "participantId": {
         "type": "string",
         "minLength": 1,
         "maxLength": 100,
         "pattern": "^[a-zA-Z0-9_-]+$"
        },
        "scope": {
         "enum": [
          "overall",
          "class",
          "heat",
          "final",
          "championship-award"
         ]
        },
        "scopeId": {
         "anyOf": [
          {
           "type": "string",
           "minLength": 1,
           "maxLength": 100,
           "pattern": "^[a-zA-Z0-9_-]+$"
          },
          {
           "type": "null"
          }
         ]
        },
        "classId": {
         "anyOf": [
          {
           "type": "string",
           "minLength": 1,
           "maxLength": 100,
           "pattern": "^[a-zA-Z0-9_-]+$"
          },
          {
           "type": "null"
          }
         ]
        },
        "position": {
         "anyOf": [
          {
           "type": "integer",
           "minimum": 1,
           "maximum": 1000
          },
          {
           "type": "null"
          }
         ]
        },
        "status": {
         "enum": [
          "finished",
          "dnf",
          "dns",
          "disqualified",
          "unknown"
         ]
        },
        "laps": {
         "anyOf": [
          {
           "type": "number",
           "minimum": 0,
           "maximum": 1000000
          },
          {
           "type": "null"
          }
         ]
        },
        "elapsedMs": {
         "anyOf": [
          {
           "type": "number",
           "minimum": 0,
           "maximum": 604800000
          },
          {
           "type": "null"
          }
         ]
        },
        "points": {
         "anyOf": [
          {
           "type": "number",
           "minimum": -1000000,
           "maximum": 1000000
          },
          {
           "type": "null"
          }
         ]
        },
        "score": {
         "anyOf": [
          {
           "type": "number",
           "minimum": -1000000000000,
           "maximum": 1000000000000
          },
          {
           "type": "null"
          }
         ]
        },
        "scoreUnit": {
         "anyOf": [
          {
           "enum": [
            "ms",
            "laps",
            "points",
            "m"
           ]
          },
          {
           "type": "null"
          }
         ]
        },
        "gap": {
         "anyOf": [
          {
           "type": "object",
           "properties": {
            "value": {
             "type": "number",
             "minimum": 0,
             "maximum": 1000000000000
            },
            "unit": {
             "enum": [
              "ms",
              "laps",
              "points",
              "m"
             ]
            }
           },
           "required": [
            "value",
            "unit"
           ],
           "additionalProperties": false
          },
          {
           "type": "null"
          }
         ]
        },
        "countedHeatIds": {
         "type": "array",
         "items": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100,
          "pattern": "^[a-zA-Z0-9_-]+$"
         },
         "maxItems": 1000
        },
        "droppedHeatIds": {
         "type": "array",
         "items": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100,
          "pattern": "^[a-zA-Z0-9_-]+$"
         },
         "maxItems": 1000
        },
        "incomplete": {
         "anyOf": [
          {
           "type": "boolean"
          },
          {
           "type": "null"
          }
         ]
        },
        "estimated": {
         "anyOf": [
          {
           "type": "boolean"
          },
          {
           "type": "null"
          }
         ]
        },
        "effects": {
         "type": "array",
         "items": {
          "type": "object",
          "properties": {
           "kind": {
            "enum": [
             "time",
             "laps",
             "points",
             "other"
            ]
           },
           "amount": {
            "type": "number",
            "minimum": -1000000000,
            "maximum": 1000000000
           },
           "reason": {
            "type": "string",
            "maxLength": 2000
           }
          },
          "required": [
           "kind",
           "amount",
           "reason"
          ],
          "additionalProperties": false
         },
         "maxItems": 2000
        }
       },
       "required": [
        "participantId",
        "scope",
        "scopeId",
        "classId",
        "position",
        "status",
        "laps",
        "elapsedMs",
        "points",
        "score",
        "scoreUnit",
        "gap",
        "countedHeatIds",
        "droppedHeatIds",
        "incomplete",
        "estimated",
        "effects"
       ],
       "additionalProperties": false
      },
      "maxItems": 10000
     },
     "systemChanges": {
      "type": "array",
      "items": {
       "type": "object",
       "properties": {
        "system": {
         "type": "string",
         "maxLength": 100
        },
        "enabled": {
         "type": "boolean"
        },
        "atMs": {
         "anyOf": [
          {
           "type": "number",
           "minimum": 0,
           "maximum": 604800000
          },
          {
           "type": "null"
          }
         ]
        }
       },
       "required": [
        "system",
        "enabled",
        "atMs"
       ],
       "additionalProperties": false
      },
      "maxItems": 2000
     },
     "scoringSnapshot": {
      "type": "null"
     },
     "notes": {
      "type": "string",
      "maxLength": 4000
     }
    },
    "required": [
     "savedAt",
     "endedBy",
     "resumed",
     "weather",
     "teams",
     "classes",
     "classification",
     "systemChanges",
     "scoringSnapshot",
     "notes"
    ],
    "additionalProperties": false
   }
  },
  "required": [
   "format",
   "provenance",
   "race",
   "context"
  ],
  "additionalProperties": false
 },
 "lap": {
  "type": "object",
  "properties": {
   "id": {
    "type": "string",
    "minLength": 1,
    "maxLength": 100,
    "pattern": "^[a-zA-Z0-9_-]+$"
   },
   "originLapId": {
    "anyOf": [
     {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "pattern": "^[a-zA-Z0-9_-]+$"
     },
     {
      "type": "null"
     }
    ]
   },
   "stintId": {
    "anyOf": [
     {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "pattern": "^[a-zA-Z0-9_-]+$"
     },
     {
      "type": "null"
     }
    ]
   },
   "heatId": {
    "anyOf": [
     {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "pattern": "^[a-zA-Z0-9_-]+$"
     },
     {
      "type": "null"
     }
    ]
   },
   "driverId": {
    "anyOf": [
     {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "pattern": "^[a-zA-Z0-9_-]+$"
     },
     {
      "type": "null"
     }
    ]
   },
   "lane": {
    "anyOf": [
     {
      "type": "integer",
      "minimum": 1,
      "maximum": 64
     },
     {
      "type": "null"
     }
    ]
   },
   "number": {
    "type": "integer",
    "minimum": 1,
    "maximum": 1000000
   },
   "durationMs": {
    "anyOf": [
     {
      "type": "number",
      "minimum": 0.001,
      "maximum": 86400000
     },
     {
      "type": "null"
     }
    ]
   },
   "endedAtMs": {
    "anyOf": [
     {
      "type": "number",
      "minimum": 0,
      "maximum": 604800000
     },
     {
      "type": "null"
     }
    ]
   },
   "valid": {
    "anyOf": [
     {
      "type": "boolean"
     },
     {
      "type": "null"
     }
    ]
   },
   "pit": {
    "anyOf": [
     {
      "type": "boolean"
     },
     {
      "type": "null"
     }
    ]
   },
   "personalRecordEligible": {
    "anyOf": [
     {
      "type": "boolean"
     },
     {
      "type": "null"
     }
    ]
   },
   "trackRecordEligible": {
    "anyOf": [
     {
      "type": "boolean"
     },
     {
      "type": "null"
     }
    ]
   },
   "countsForDistance": {
    "type": "boolean"
   },
   "distanceM": {
    "anyOf": [
     {
      "type": "number",
      "minimum": 0,
      "maximum": 100000
     },
     {
      "type": "null"
     }
    ]
   },
   "flags": {
    "type": "array",
    "items": {
     "enum": [
      "invalid",
      "tooSlow",
      "late",
      "redFlag"
     ]
    },
    "maxItems": 4
   },
   "reason": {
    "type": "string",
    "maxLength": 500
   }
  },
  "required": [
   "id",
   "originLapId",
   "stintId",
   "heatId",
   "driverId",
   "lane",
   "number",
   "durationMs",
   "endedAtMs",
   "valid",
   "pit",
   "personalRecordEligible",
   "trackRecordEligible",
   "countsForDistance",
   "distanceM",
   "flags",
   "reason"
  ],
  "additionalProperties": false
 }
};
