import * as Admin from 'firebase-admin';
import * as Express from 'express';
import * as BodyParser from 'body-parser';
import { v4 as uuid } from 'uuid';

enum QuestionType {
  FREE_RESPONSE,
  MULTIPLE_CHOICE
}

interface Question {
  type: QuestionType;
  question: string;
  answer: string;
}

interface Section {
  name: string;
  questions: Question[];
}

interface Questionnaire {
  id?: string;
  name: string;
  sections: Section[];
}

interface QuestionnaireResponse {
  [key: string]: Questionnaire;
}

const api = '/api';
const v1 = `${api}/v1`;
const base = v1;

const admin = Admin.initializeApp({
  credential: Admin.credential.cert(
    JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  ),
  databaseURL: process.env.DATABASE_URL
});

const verifyToken = async (jwt: string): Promise<Admin.auth.DecodedIdToken> => {
  return admin
    .auth()
    .verifyIdToken(jwt)
    .then((decodedIdToken) => {
      return decodedIdToken;
    })
    .catch(() => {
      return null;
    });
};

const extractJwt = (auth: string) => {
  return auth.split(' ')[1];
};

const extractAndVerifyJwt = async (
  request: Express.Request
): Promise<string> => {
  const auth = request.headers.authorization;
  if (auth) {
    const token = extractJwt(auth);
    return verifyToken(token)
      .then((decodedIdToken) => {
        if (decodedIdToken) {
          return decodedIdToken.uid;
        } else {
          return null;
        }
      })
      .catch(() => {
        return null;
      });
  } else {
    return Promise.resolve(null);
  }
};

const refOnceVal = async <T>(ref: string) => {
  return admin
    .database()
    .ref(ref)
    .once('value')
    .then((snapshot) => {
      return snapshot.val() as T;
    });
};

const getQuestionnaires = (uid: string) => {
  return refOnceVal<QuestionnaireResponse>(`/questionnaires/${uid}`);
};

const getQuestionnaire = (uid: string, questionnaireId: string) => {
  return refOnceVal<Questionnaire>(
    `/${uid ? `questionnaires/${uid}` : 'published'}/${questionnaireId}`
  );
};

const postQuestionnaire2 = (uid: string, questionnaire: Questionnaire) => {
  return admin
    .database()
    .ref(`/questionnaires/${uid}/${questionnaire.id}`)
    .set(questionnaire);
};

// TODO?: Does this need more locking down?
const publishQuestionnaire = (
  questionnaireId: string,
  questionnaire: Questionnaire
) => {
  return admin
    .database()
    .ref(`/published/${questionnaireId}`)
    .set(questionnaire);
};

const postQuestionnaire = async (uid: string, questionnaire: Questionnaire) => {
  return admin
    .database()
    .ref(`/questionnaires/${uid}`)
    .push(questionnaire)
    .then((ref) => ref.key);
};

const putQuestionnaire = (
  uid: string,
  questionnaireId: string,
  questionnaire: Questionnaire
) => {
  return admin
    .database()
    .ref(`/questionnaires/${uid}/${questionnaireId}`)
    .set(questionnaire);
};

const deleteQuestionnaire = (uid: string, questionnaireId: string) => {
  return admin
    .database()
    .ref(`/questionnaires/${uid}/${questionnaireId}`)
    .remove();
};

const unListQuestionnaire = (questionnaireId: string) => {
  // TODO: Lock Down
  return admin.database().ref(`/published/${questionnaireId}`).remove();
};

const questionnaireRequestHandler = (
  request: Express.Request,
  response: Express.Response,
  fetchFn: (uid: string, questionnaireId?: string) => Promise<any>,
  questionnaireId?: string
) => {
  extractAndVerifyJwt(request).then((uid) => {
    if (uid) {
      const fetch = () => {
        if (questionnaireId) {
          return fetchFn(uid, questionnaireId);
        } else {
          return fetchFn(uid);
        }
      };

      fetch()
        .then((responseData) => {
          response.json(responseData);
        })
        .catch(() => {
          response.sendStatus(500);
        });
    } else {
      response.sendStatus(401);
    }
  });
};

const server = Express();
server.use(BodyParser.json());

server.get('/welcome', (_request, response) => {
  response.json({
    message: 'hello'
  });
});

server.get(`${base}/questionnaires`, (request, response) => {
  questionnaireRequestHandler(request, response, getQuestionnaires);
});

server.get(
  `${base}/questionnaires/published/:questionnaireId`,
  (request, response) => {
    const questionnaireId = request.params.questionnaireId;
    getQuestionnaire(null, questionnaireId)
      .then((questionnaire) => {
        return response.json(questionnaire);
      })
      .catch(() => {
        response.sendStatus(500);
      });
  }
);

server.get(`${base}/questionnaires/:questionnaireId`, (request, response) => {
  const questionnaireId = request.params.questionnaireId;
  questionnaireRequestHandler(
    request,
    response,
    getQuestionnaire,
    questionnaireId
  );
});

server.post(`${base}/questionnaires`, (request, response) => {
  extractAndVerifyJwt(request).then((uid) => {
    if (uid) {
      const questionnaire: Questionnaire = request.body;
      const id = uuid();
      questionnaire.id = id;
      postQuestionnaire(uid, questionnaire)
        .then((key) => {
          response.json({
            key
          });
        })
        .catch(() => {
          response.sendStatus(500);
        });
    } else {
      response.sendStatus(401);
    }
  });
});

server.post(`${base}/questionnaires2`, (request, response) => {
  extractAndVerifyJwt(request).then((uid) => {
    if (uid) {
      const questionnaire: Questionnaire = request.body;
      const id = uuid();
      questionnaire.id = id;
      postQuestionnaire2(uid, questionnaire)
        .then(() => {
          response.json({
            id
          });
        })
        .catch(() => {
          response.sendStatus(500);
        });
    } else {
      response.sendStatus(401);
    }
  });
});

// TODO: Lock down
server.delete(
  `${base}/questionnaires/unlist/:questionnaireId`,
  (request, response) => {
    extractAndVerifyJwt(request).then((uid) => {
      if (uid) {
        const questionnaireId = request.params.questionnaireId;
        unListQuestionnaire(questionnaireId)
          .then(() => {
            response.json();
          })
          .catch(() => {
            response.sendStatus(500);
          });
      } else {
        response.sendStatus(401);
      }
    });
  }
);

// TODO?: Does this need more locking down?
server.put(
  `${base}/questionnaires/list/:questionnaireId`,
  (request, response) => {
    extractAndVerifyJwt(request).then((verified) => {
      if (verified) {
        const questionnaireId = request.params.questionnaireId;
        const questionnaire: Questionnaire = request.body;
        publishQuestionnaire(questionnaireId, questionnaire)
          .then(() => {
            response.json();
          })
          .catch(() => {
            response.sendStatus(500);
          });
      } else {
        response.sendStatus(401);
      }
    });
  }
);

server.put(`${base}/questionnaires/:questionnaireId`, (request, response) => {
  extractAndVerifyJwt(request).then((uid) => {
    if (uid) {
      const questionnaireId = request.params.questionnaireId;
      const questionnaire: Questionnaire = request.body;
      putQuestionnaire(uid, questionnaireId, questionnaire)
        .then(() => {
          response.json();
        })
        .catch(() => {
          response.sendStatus(500);
        });
    } else {
      response.sendStatus(401);
    }
  });
});

server.delete(
  `${base}/questionnaires/:questionnaireId`,
  (request, response) => {
    extractAndVerifyJwt(request).then((uid) => {
      if (uid) {
        const questionnaireId = request.params.questionnaireId;
        deleteQuestionnaire(uid, questionnaireId)
          .then(() => {
            response.json();
          })
          .catch(() => {
            response.sendStatus(500);
          });
      } else {
        response.sendStatus(401);
      }
    });
  }
);

const port = +process.env.PORT || 5000;
const host = process.env.HOST;
const callbackFn = (port: number) => {
  console.log(`Tap Vote 🚀 server started on port ${port}`);
};
console.log(`HOST: ${host ? host : 'HOST env variable is not set'}`);
console.log(`PORT: ${port ? port : 'PORT env variable is not set'}`);
host
  ? server.listen(port, host, () => callbackFn(port))
  : server.listen(port, () => callbackFn(port));
